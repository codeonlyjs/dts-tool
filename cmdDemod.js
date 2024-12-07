import path from 'node:path';
import ts from 'typescript';
import { MappedSource } from "./MappedSource.js";
import { find_bol_ws, find_next_line_ws } from './LineMap.js';
import { SourceFile } from "./SourceFile.js";
import { clargs, showArgs } from "@toptensoftware/clargs";
import { loadOriginalFile, isDeclarationNode, regExpForName } from "./utils.js";


function showHelp()
{
    console.log("\nUsage: npx codeonlyjs/dts-tool demod <dtsfile> <modulename>");

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


export function cmdDemod(tail)
{
    let inFile = null;
    let outFile = null;
    let moduleName = null;
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

    // Build module map
    let moduleMap = new Map();
    moduleList.forEach(x => moduleMap.set(x.name, x));

    // Remove unneeded imports
    moduleList.forEach(x => removeImports(x));

    // Write new file
    let msOut = new MappedSource();
    msOut.append(`declare module "${moduleName}" {\n`);
    moduleList.forEach(x => msOut.append(x.mappedSource));
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
                // Get the body text and trim to whole lines
                let name = node.name.getText(ast);
                let body = node.body.getText(ast);
                let trimStart = /^\s*\{\s*/.exec(body);
                let trimEnd = /\s*\}\s*$/.exec(body);
                let bodyStart = node.body.pos + trimStart[0].length;
                let bodyEnd = node.body.end - trimEnd[0].length;
                bodyStart = find_bol_ws(msIn.source, bodyStart);
                bodyEnd = find_next_line_ws(msIn.source, bodyEnd);

                // Get module
                let module = {
                    name,
                    node,
                    bodyStart,
                    bodyEnd,
                    mappedSource: msIn.substring(bodyStart, bodyEnd),
                }
                list.push(module);
                return;
            }

            if (node.kind == ts.SyntaxKind.EndOfFileToken)
                return;

            throw new Error(`Unexpected node kind: ${node.kind}`);
        }
    }

    function removeImports(module)
    {
        let deletions = [];
        ts.forEachChild(module.node, walk);
        deletions.sort((a,b) => b.pos - a.pos);

        let prev = null;
        for (let d of deletions)
        {
            // Sanity check no overlapping ranges
            if (prev && d.end > prev.pos)
                throw new Error("overlapping delete ranges");
            prev = d;

            module.mappedSource.delete(
                d.pos - module.bodyStart,
                d.end - d.pos
            );
        }
    
        function walk(node)
        {
            if (isDeclarationNode(node))
            {
                // Delete #private fields
                if (node.name && node.name.getText(ast) == "#private")
                {
                    let pos = find_bol_ws(msIn.source, node.getStart(ast));
                    let end = find_next_line_ws(msIn.source, node.end);
                    deletions.push({ pos, end });
                    return;
                }

                let comments = ts.getLeadingCommentRanges(msIn.source, node.pos);
                if (comments)
                {
                    // Remove any redundant @callback|@typedef declarations
                    for (let i=0; i<comments.length - 1; i++)
                    {
                        let c = comments[i];
                        let text = msIn.source.substring(c.pos, c.end);
                        if (text.match(/@[callback|typedef]/))
                        {
                            let pos = find_bol_ws(msIn.source, c.pos);
                            let end = find_next_line_ws(msIn.source, c.end);
                            deletions.push({ pos, end });
                        }
                    }

                    // Remove internal declarations
                    if (comments.length && stripInternal)
                    {
                        let c = comments[comments.length - 1];
                        let text = msIn.source.substring(c.pos, c.end);
                        if (text.match(/@internal/))
                        {
                            let pos = find_bol_ws(msIn.source, c.pos);
                            let end = find_next_line_ws(msIn.source, node.end);
                            deletions.push({pos, end});
                            return; // don't recurse deeper into this node
                        }
                    }
                }
            }
            if (ts.isExportDeclaration(node))
            {
                // Remove any: export <anything> from "<known module>"
                let moduleName = node.moduleSpecifier.getText(ast);
                if (moduleMap.has(moduleName))
                {
                    let pos = find_next_line_ws(msIn.source, node.pos);
                    let end = find_next_line_ws(msIn.source, node.end);
                    deletions.push({ pos, end });
                }
            }
            if (ts.isImportDeclaration(node))
            {
                // Remove any: import <anything> from "<known module>"
                let moduleName = node.moduleSpecifier.getText(ast);
                if (moduleMap.has(moduleName))
                {
                    let pos = find_next_line_ws(msIn.source, node.pos);
                    let end = find_next_line_ws(msIn.source, node.end);
                    deletions.push({ pos, end });
                }
            }
            if (ts.isImportTypeNode(node))
            {
                // Remove: import(<knownmodule>).
                let importedModule = node.argument.getText(ast);
                if (moduleMap.has(importedModule))
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
            ts.forEachChild(node, walk);
        }
    }
}


