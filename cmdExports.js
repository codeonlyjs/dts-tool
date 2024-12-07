import path from 'node:path';
import ts from 'typescript';
import { MappedSource } from "./MappedSource.js";
import { find_bol_ws, find_next_line_ws } from './LineMap.js';
import { SourceFile } from "./SourceFile.js";
import { clargs, showArgs } from "@toptensoftware/clargs";
import { 
    loadOriginalFile, 
    isDeclarationNode, 
    regExpForName, 
    isExport, 
    stripQuotes,
    isPrivateOrInternal
} from "./utils.js";


function showHelp()
{
    console.log("\nUsage: npx codeonlyjs/dts-tool exports <dtsfile> <modulename>");

    console.log("\nOptions:");
    showArgs({
        "<dtsfile>": "The input .d.ts file (will be overwritten)",
        "<moduleName>": "The module name of the resulting collapsed .d.ts file",
        "--strip-internal": "Strip declarations marked @internal",
        "-h, --help":    "Show this help",
    });

    console.log(`
Collapses multiple module definitions in a .d.ts file into 
single module.  Typical use case is for fixing up the files 
produced by tsc when extracting the definitions from JS code.

Also removes an self referencing imports, redundant exports,
unneeded @typedef and @callback comment blocks.  Can also
remove declarations marked @internal (use --strip-internal).

If input file has a source map, new updated map is generated.
`);
}


export function cmdExports(tail)
{
    let inFile = null;
    let outFile = null;
    let moduleName = null;
    let rootModules = [];
    let stripInternal = false;

    let args = clargs(tail);
    while (args.next())
    {
        switch (args.name)
        {
            case "help":
                showHelp();
                process.exit();

            case "strip-internal":
                stripInternal = args.readBoolValue();
                break;

            case "module":
                rootModules.push(args.readValue());
                break;

            case "out":
                outFile = args.readValue();
                break;

            case null:
                if (inFile == null)
                    inFile = args.readValue();
                else if (moduleName == null)
                    moduleName = args.readValue();
                else
                    console.error(`Too many arguments: ${args.readValue()}`);
                break;

            default:
                console.error(`Unknown argument: ${args.name}`);
                process.exit(7);
        }
    }


    if (!inFile)
    {
        console.error("missing argument: input file");
        process.exit(7);
    }

    if (!moduleName)
    {
        console.error("missing argument: module name");
        process.exit(7);
    }

    // Read input file
    let source = SourceFile.fromFile(inFile);

    let relbase = path.dirname(path.resolve(inFile));
    
    // Parse input file
    let ast = ts.createSourceFile(
        inFile, 
        source.code,
        ts.ScriptTarget.Latest, 
        true, 
    );

    // Simplify source map
    let msIn = simplifySourceMap(ast);

    // Build module list
    let moduleList = buildModuleList(ast);

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

    function simplifySourceMap(ast)
    {
        // Create a simplified symbol map with just the 
        // declared names

        // Start with just the source code
        let map = [];
        ts.forEachChild(ast, walk);
        return new MappedSource(source.code, map);

        function walk(node)
        {
            if (isDeclarationNode(node) && node.name && node.kind != ts.SyntaxKind.ModuleDeclaration)
            {
                // Get the name and its position
                let name = node.name.getText(ast);
                let nameOffset = node.name.getStart(ast);

                // Ignore private fields
                if (!name.startsWith("#"))
                {
                    // Find the original position
                    let namepos = source.lineMap.fromOffset(nameOffset);
                    let originalPos = source.sourceMap.originalPositionFor(namepos);
                    if (originalPos.source)
                    {
                        let originalSource = originalPos.source;

                        // Load the original file
                        let originalSourceFile = loadOriginalFile(path.join(relbase, originalPos.source));

                        // Look for the symbol

                        // Searching from the start of the line instead of the original position column
                        // helps this works for cases like where name is before the declaration eg:  "{ name: function () }"
                        // In these cases the originalPos.column is after "name"
                        let originalOffsetStart = originalSourceFile.lineMap.toOffset(originalPos.line, 0);//originalPos.column);

                        let rx = new RegExp(regExpForName(name), 'g');
                        rx.lastIndex = originalOffsetStart;
                        let m = rx.exec(originalSourceFile.code);
                        if (m)
                        {
                            originalOffsetStart = m.index;
                            originalPos = originalSourceFile.lineMap.fromOffset(originalOffsetStart);
                            
                            // Start of name
                            map.push({
                                offset: nameOffset,
                                name: name,
                                source: originalSource,
                                originalLine: originalPos.line,
                                originalColumn: originalPos.column,
                            });

                            // End of name
                            map.push({
                                offset: nameOffset + name.length,
                                name: name,
                                source: originalSource,
                                originalLine: originalPos.line,
                                originalColumn: originalPos.column + name.length,
                            });
                        }
                        else
                        {
                            console.error(`warning: couldn't find original position for '${name}' - ${namepos.line}:${namepos.column}'`);
                        }
                    }
                    else
                        console.error(`warning: couldn't find original position for '${name}' - ${namepos.line}:${namepos.column} (no original pos)`);
                }
            }

            ts.forEachChild(node, walk);
        }

    }

    function buildModuleList(ast)
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
                    exports: getModuleExports(node),
                }
                list.push(module);
                return;
            }

            if (node.kind == ts.SyntaxKind.EndOfFileToken)
                return;

            throw new Error(`Unexpected node kind: ${node.kind}`);
        }
    }

    function getModuleExports(module)
    {
        let moduleName = stripQuotes(module.name.getText(ast));
        let exports = [];
        ts.forEachChild(module, walk);
        return exports;

        function walk(node)
        {
            if (isExport(node) && node.name)
            {
                // Get the declaration name
                let name = node.name.getText(ast);
                
                // Get the immediately preceding comment
                let startPos = node.getStart(ast);
                let comments = ts.getLeadingCommentRanges(msIn.source, node.pos);
                if (comments && comments.length > 0)
                {
                    startPos = comments[comments.length - 1].pos;
                }

                // Work out the full range of text
                let pos = find_bol_ws(msIn.source, startPos);
                let end = find_next_line_ws(msIn.source, node.end);

                // Extract it
                let definition = msIn.substring(pos, end);

                exports.push({
                    name, 
                    node,
                    originalPosition: pos,
                    definition
                });
            }
            else if (ts.isExportDeclaration(node))
            {
                // Get the module name
                let moduleSpecifier = stripQuotes(node.moduleSpecifier.getText(ast));

                if (node.exportClause)
                {
                    symbols = [];
                    for (let e of node.exportClause.elements)
                    {
                        if (e.propertyName)
                        {
                            console.error(`Renaming exports not supported, ignoring "${e.getText(ast)}" in ${module.name.getText(ast)}`);
                        }
                        exports.push({
                            name: e.name.getText(ast),
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
        if (isPrivateOrInternal(ast, declaration.node))
            return;

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
            let pos = node.getStart(ast);
            let comments = ts.getLeadingCommentRanges(msIn.source, node.pos);
            if (comments && comments.length > 0)
                pos = comments[comments.length-1].pos;

            pos = find_bol_ws(msIn.source, pos);
            let end = find_next_line_ws(msIn.source, node.end);
            deletions.push({ pos, end });
        }
    
        function walk(node)
        {
            if (isDeclarationNode(node))
            {
                // Delete #private fields and anything starting with _
                if (node.name)
                {
                    let name = node.name.getText(ast);
                    if (name == "#private" || name.startsWith("_"))
                    {
                        deleteNode(node);
                        return;
                    }
                }

                // Delete anything marked @internal or @private
                if (isPrivateOrInternal(ast, node))
                {
                    deleteNode(node);
                    return;
                }
            }
            
            if (ts.isImportTypeNode(node))
            {
                // Remove: import(<knownmodule>).
                let importedModule = getModule(stripQuotes(node.argument.getText(ast)));
                if (importedModule)
                {
                    let typeName = node.qualifier.getText(ast);
                    if (importedModule.resolvedExports.some(x => x.name == typeName))
                    {
                        let pos = node.pos;
                        while (msIn.source[pos] == ' ')
                            pos++;
                        let text = msIn.source.substring(pos, node.qualifier.pos);

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


