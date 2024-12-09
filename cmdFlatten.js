import path from 'node:path';
import ts from 'typescript';
import { MappedSource } from "./MappedSource.js";
import { find_bol_ws, find_next_line_ws } from './LineMap.js';
import { SourceFile } from "./SourceFile.js";
import { clargs, showArgs } from "@toptensoftware/clargs";
import { 
    isDeclarationNode, 
    isExport, 
    stripQuotes,
    isPrivateOrInternal
} from "./utils.js";
import { createSourceMap } from './sourceMap.js';


function showHelp()
{
    console.log("\nUsage: npx codeonlyjs/dts-tool flatten <modulename> <dtsfile>... ");

    console.log("\nOptions:");
    showArgs({
        "<moduleName>": "The module name of the resulting flattened .d.ts file",
        "<dtsfile>": "The input .d.ts file (or files)",
        "--module:<module>": "The name of the module to export (defaults to last in file)",
        "-h, --help":    "Show this help",
    });

    console.log(`
Flattens the export definitions in a .d.ts file into 
single module.  Typical use case is for fixing up the files 
produced by tsc when extracting the definitions from JS code.

Also removes an self referencing imports, redundant exports,
unneeded @typedef and @callback comment blocks, @internal and
private declarations.

If input file has a source map, new updated map is generated.
`);
}


export function cmdFlatten(tail)
{
    let inFiles = [];
    let outFile = null;
    let moduleName = null;
    let rootModules = [];

    let args = clargs(tail);
    while (args.next())
    {
        switch (args.name)
        {
            case "help":
                showHelp();
                process.exit();

            case "module":
                rootModules.push(args.readValue());
                break;

            case "out":
                outFile = args.readValue();
                break;

            case null:
                if (moduleName == null)
                    moduleName = args.readValue();
                else
                    inFiles.push(args.readValue());
                break;

            default:
                console.error(`Unknown argument: ${args.name}`);
                process.exit(7);
        }
    }

    if (!moduleName)
    {
        console.error("missing argument: module name");
        process.exit(7);
    }
    
    if (!inFiles.length)
    {
        console.error("missing argument: input file");
        process.exit(7);
    }

    let moduleList = [];
    for (let inFile of inFiles)
    {
        // Read input file
        let source = SourceFile.fromFile(inFile);

        // Parse input file
        let astFile = ts.createSourceFile(
            inFile, 
            source.code,
            ts.ScriptTarget.Latest, 
            true, 
        );

        // Simplify source map
        let ms = createSourceMap(source, astFile);

        // Build module list
        moduleList.push(...buildModuleList(ms, astFile));
    }

    // If user didn't specify modules to include, just 
    // use the last defined one
    if (rootModules.length == 0)
        rootModules = [ moduleList[moduleList.length - 1].name ];

    // Build module map
    let moduleMap = new Map();
    moduleList.forEach(x => moduleMap.set(x.name, x));

    // Resolve all `export ... from "module"`
    resolveExportDeclarations();

    // Build initial list of exports
    let exports = new Set();
    for (let rm of rootModules)
    {
        let mod = getModule(rm);
        mod?.resolvedExports.forEach(x => exports.add(x))
    }

    // Remove unneeded imports
    //moduleList.forEach(x => removeImports(x));

    // Write new file
    let msOut = new MappedSource();
    msOut.append(`declare module "${moduleName}" {\n`);
    Array.from(exports).forEach(x => writeDeclaration(msOut, x));
    msOut.append(`\n}\n`);
    msOut.save(outFile ?? inFile);


    function buildModuleList(ms, ast)
    {
        let list = [];
        ts.forEachChild(ast, walk);
        return list;

        function walk(node)
        {
            if (ts.isModuleDeclaration(node))
            {
                // Get the module name
                let name = stripQuotes(node.name.getText(ast));

                // Get module
                let module = {
                    name,
                    node,
                    mappedSource: ms,
                    exports: getModuleExports(ms, node),
                }
                list.push(module);
                return;
            }

            if (node.kind == ts.SyntaxKind.EndOfFileToken)
                return;

            throw new Error(`Unexpected node kind: ${node.kind}`);
        }
    }

    function getModuleExports(ms, module)
    {
        let exports = [];
        ts.forEachChild(module, walk);
        return exports;

        function walk(node)
        {
            if (isExport(node) && node.name)
            {
                // Get the declaration name
                let name = node.name.getText();
                
                // Get the immediately preceding comment
                let startPos = node.getStart();
                let comments = ts.getLeadingCommentRanges(ms.source, node.pos);
                if (comments && comments.length > 0)
                {
                    startPos = comments[comments.length - 1].pos;
                }

                // Work out the full range of text
                let pos = find_bol_ws(ms.source, startPos);
                let end = find_next_line_ws(ms.source, node.end);

                // Extract it
                let definition = ms.substring(pos, end);

                exports.push({
                    name, 
                    node,
                    originalPosition: pos,
                    definition,
                    mappedSource: ms,
                });
            }
            else if (ts.isExportDeclaration(node))
            {
                // Get the module name
                let moduleSpecifier = stripQuotes(node.moduleSpecifier.getText());

                if (node.exportClause)
                {
                    symbols = [];
                    for (let e of node.exportClause.elements)
                    {
                        if (e.propertyName)
                        {
                            console.error(`Renaming exports not supported, ignoring "${e.getText()}" in ${module.name.getText()}`);
                        }
                        exports.push({
                            name: e.name.getText(),
                            from: moduleSpecifier,
                        });
                    }
                }
                else
                {
                    exports.push({
                        name: "*",
                        from: moduleSpecifier
                    });
                }
                // Get the module name
                return;
            }
            if (ts.isModuleBlock(node))
            {
                ts.forEachChild(node, walk);
            }
        }
    }

    function getModule(moduleName)
    {
        // Get the module
        let module = moduleMap.get(moduleName);
        if (!module)
            module = moduleMap.get(moduleName + "/index");
        if (!module)
        {
            console.error(`unknown module: ${moduleName}, ignored`)
            return null;
        }
        return module;
    }

    function resolveExportDeclarations()
    {
        for (let m of moduleList)
        {
            resolveExportDeclarationsForModule(m);
        }
    }

    function resolveExportDeclarationsForModule(module)
    {
        if (module.resolvedExports)
            return;
        module.resolvedExports = []; // prevent re-entry

        let resolvedExports = new Set();
        for (let e of module.exports)
        {
            // Already defined?
            if (e.definition)
            {
                resolvedExports.add(e);
            }
            else
            {
                // Find definition in another module
                let importFromModule = getModule(e.from);
                if (!importFromModule)
                    continue;
                
                // Make sure it's resolved
                resolveExportDeclarationsForModule(importFromModule);

                if (e.name == "*")
                {
                    for (let e of importFromModule.resolvedExports)
                    {
                        resolvedExports.add(e);
                    }
                }
                else
                {
                    let e = importFromModule.resolveExports.findIndex(x => x.name == e.name);
                    if (e)
                    {
                        resolvedExports.add(e);
                    }
                    else
                    {
                        console.error(`warning: couldn't find export '${e.name}' in '${e.from}'`);
                    }
                }
            }
        }

        module.resolvedExports = Array.from(resolvedExports);
    }

    function writeDeclaration(out, declaration)
    {
        // Ignore if internal
        if (isPrivateOrInternal(declaration.node))
            return;

        let ms = declaration.mappedSource;

        // Clean up the declaration
        let deletions = [];
        ts.forEachChild(declaration.node, walk);
        deletions.sort((a,b) => b.pos - a.pos);
        let prev = null;
        for (let d of deletions)
        {
            // Sanity check no overlapping ranges
            if (prev && d.end > prev.pos)
                throw new Error("overlapping delete ranges");
            prev = d;

            declaration.definition.delete(
                d.pos - declaration.originalPosition,
                d.end - d.pos
            );
        }

        // Write ite
        out.append(declaration.definition);

        // Delete a node and 1x preceding comment block
        function deleteNode(node)
        {
            let pos = node.getStart();
            let comments = ts.getLeadingCommentRanges(ms.source, node.pos);
            if (comments && comments.length > 0)
                pos = comments[comments.length-1].pos;

            pos = find_bol_ws(ms.source, pos);
            let end = find_next_line_ws(ms.source, node.end);
            deletions.push({ pos, end });
        }
    
        function walk(node)
        {
            if (isDeclarationNode(node))
            {
                // Delete #private fields and anything starting with _
                if (node.name)
                {
                    let name = node.name.getText();
                    if (name == "#private" || name.startsWith("_"))
                    {
                        deleteNode(node);
                        return;
                    }
                }

                // Delete anything marked @internal or @private
                if (isPrivateOrInternal(node))
                {
                    deleteNode(node);
                    return;
                }
            }
            
            if (ts.isImportTypeNode(node))
            {
                // Remove: import(<knownmodule>).
                let importedModule = getModule(stripQuotes(node.argument.getText()));
                if (importedModule)
                {
                    let typeName = node.qualifier.getText();
                    if (importedModule.resolvedExports.some(x => x.name == typeName))
                    {
                        let pos = node.pos;
                        while (ms.source[pos] == ' ')
                            pos++;
                        let text = ms.source.substring(pos, node.qualifier.pos);

                        // Track for deletion
                        deletions.push({
                            pos: pos,
                            end: node.qualifier.pos,
                        })
                    }
                }
            }
            ts.forEachChild(node, walk);
        }
    }
}


