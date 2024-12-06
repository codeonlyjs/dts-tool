#!/usr/bin/env node

import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';
import ts from 'typescript';
import { MappedSource } from "./MappedSource.js";
import { find_bol_ws, find_next_line_ws } from './LineMap.js';
import { clargs, showPackageVersion, showArgs } from "@toptensoftware/clargs";
import { SourceMapConsumer } from "@jridgewell/source-map";
import { LineMap } from "./LineMap.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

let inFile = null;
let outFile = null;
let moduleName = null;
let stripInternal = false;
let listDefs = false;
let lookupMapPosition = null;


function showVersion()
{
    showPackageVersion(path.join(__dirname, "package.json"));
}

function showHelp()
{
    showVersion();

    console.log("\nUsage: npx codeonlyjs/dts-tool [options] <dtsfile> <modulename>");

    console.log("\nOptions:");
    showArgs({
        "<dtsfile>": "The input .d.ts file (will be overwritten)",
        "<moduleName>": "The module name of the resulting collapsed .d.ts file",
        "--list": "List definitions and source locations",
        "--strip-internal": "Strip declarations marked @internal",
        "--map:<line>[:col]": "Show source map info for source/line",
        "-v, --version": "Show version info",
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


let args = clargs();
while (args.next())
{
    switch (args.name)
    {
        case "version":
            showVersion();
            process.exit(0);

        case "help":
            showHelp();
            process.exit(0);

        case "strip-internal":
            stripInternal = args.readBoolValue();
            break;

        case "list":
            listDefs = args.readBoolValue();
            break;

        case "out":
            outFile = args.readValue();
            break;

        case "map":
        {
            let parts = args.readValue().split(":");
            if (parts.length == 1)
            {
                lookupMapPosition = { line: parseInt(parts[0]), column: 0 };
            }
            else if (parts.length == 2)
            {
                lookupMapPosition = { line: parseInt(parts[0]), column: parseInt(parts[1]) };
            }
            else
                throw new Error("Invalid line:col value");
            break;
        }

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

if (!moduleName && !listDefs && !lookupMapPosition)
{
    console.error("missing argument: module name");
    process.exit(7);
}


if (listDefs)
{
    list_definitions();
}
else if (lookupMapPosition)
{
    lookup_map(lookupMapPosition);
}
else
{
    collapse_modules();
}


function collapse_modules()
{
    // Read input file
    let msIn = MappedSource.FromSourceFile(inFile);
    
    // Parse input file
    let ast = ts.createSourceFile(
        inFile, 
        msIn.source,
        ts.ScriptTarget.Latest, 
        true, 
    );

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
            let nodetext = node.getText(ast);
            if (is_declaration_node(node))
            {
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

function is_declaration_node(node)
{
    switch (node.kind)
    {
        case ts.SyntaxKind.ClassDeclaration:
        case ts.SyntaxKind.FunctionDeclaration:
        case ts.SyntaxKind.VariableDeclaration:
        case ts.SyntaxKind.VariableDeclarationList:
        case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.PropertyDeclaration:
            return true;
    }
    return false;
}


function list_definitions()
{
    let source = fs.readFileSync(inFile, "utf8");
    let mapName = /\/\/# sourceMappingURL=(.*)$/m.exec(source);
    let smc;
    if (mapName)
    {
        let fullMapName = path.join(path.dirname(path.resolve(inFile)), mapName[1]);
        smc = new SourceMapConsumer(JSON.parse(fs.readFileSync(fullMapName, "utf8")));
    }

    let lm = new LineMap(source, { lineBase: 1 });

    // Parse input file
    let ast = ts.createSourceFile(
        inFile, 
        source,
        ts.ScriptTarget.Latest, 
        true, 
    );

    // List all definitions
    let moduleName = "";
    ts.forEachChild(ast, list_definitions);

    function list_definitions(node)
    {
        if (ts.isModuleDeclaration(node))
        {
            moduleName = node.name.getText(ast);
            console.log(`${moduleName}`);
            ts.forEachChild(node, list_definitions);
            moduleName = "";
            return;
        }
        else if (is_declaration_node(node))
        {
            if (node.name)
            {
                let name = node.name.getText(ast);
                if (name == "nextFrame")
                    debugger;
                //let name2 = source.substring(node.name.pos, node.name.pos + 10);
                let pos = "";
                if (smc)
                {
                    let namepos = node.name.getStart(ast);
                    let lp = lm.fromOffset(namepos);
                    let lpo = smc.originalPositionFor(lp);
                    pos = `${inFile}:${lp.line}:${lp.column} => ${lpo.source}:${lpo.line}:${lpo.column}`;
                }
                console.log(`  ${name} ${pos}`);
            }
        }
        ts.forEachChild(node, list_definitions);
    }
}

function lookup_map(pos)
{
    let mapFile;
    if (inFile.endsWith(".map"))
    {
        mapFile = inFile;
    }
    else
    {
        let source = fs.readFileSync(inFile, "utf8");
        let mapName = /\/\/# sourceMappingURL=(.*)$/m.exec(source);
        mapFile = path.join(path.dirname(path.resolve(inFile)), mapName[1]);
    }

    let smc = new SourceMapConsumer(JSON.parse(fs.readFileSync(mapFile, "utf8")));

    let op = smc.originalPositionFor(pos);
    console.log(`${inFile}:${pos.line}:${pos.column} => ${op.source}("${op.name}"):${op.line}:${op.column}`);
}
