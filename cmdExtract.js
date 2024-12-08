import ts from 'typescript';
import { find_bol_ws, find_next_line_ws } from './LineMap.js';
import { SourceFile } from "./SourceFile.js";
import { clargs, showArgs } from "@toptensoftware/clargs";
import { stripComments, parseJsDocComment } from './jsdoc.js';


function showHelp()
{
    console.log("\nUsage: npx codeonlyjs/dts-tool extract <dtsfile>");

    console.log("\nOptions:");
    showArgs({
        "<dtsfile>": "The input .d.ts file",
        "-h, --help":    "Show this help",
    });
}


export function cmdExtract(tail)
{
    let inFile = null;

    let args = clargs(tail);
    while (args.next())
    {
        switch (args.name)
        {
            case "help":
                showHelp();
                process.exit();

            case null:
                if (inFile == null)
                    inFile = args.readValue();
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

    // Read input file
    let source = SourceFile.fromFile(inFile);

    // Parse input file
    let ast = ts.createSourceFile(
        inFile, 
        source.code,
        ts.ScriptTarget.Latest, 
        true, 
    );

    // Process all statements
    let helpInfos = ast.statements.map(x => process(x));

    console.log(JSON.stringify(helpInfos, null, 4));

    function process(node)
    {
        switch (node.kind)
        {
            case ts.SyntaxKind.ModuleDeclaration:
                return processModule(node);
            case ts.SyntaxKind.FunctionDeclaration:
                return processFunction(node);
            case ts.SyntaxKind.ClassDeclaration:
                return processClass(node);
            case ts.SyntaxKind.Constructor:
                return processConstructor(node);
            case ts.SyntaxKind.PropertyDeclaration:
                return processProperty(node);
            case ts.SyntaxKind.MethodDeclaration:
                return processMethod(node);
            case ts.SyntaxKind.GetAccessor:
                return processGetAccessor(node);
            case ts.SyntaxKind.SetAccessor:
                return processSetAccessor(node);
            case ts.SyntaxKind.TypeAliasDeclaration:
                return processTypeAlias(node);
            case ts.SyntaxKind.PropertySignature:
                return processPropertySignature(node);
            case ts.SyntaxKind.VariableStatement:
                return processVariableStatement(node);
            case ts.SyntaxKind.VariableDeclaration:
                return processVariableDeclaration(node);
        }

        throw new Error(`Don't know how to process node kind: ${node.kind}`);
    }

    function postProcessMembers(members)
    {
        for (let i=0; i<members.length; i++)
        {
            if (members[i].kind == "variables")
            {
                let replaceWith = members[i].declarations;
                members.splice(i, 1, ...replaceWith);
                i += replaceWith - 1;
            }
        }
        return members;
    }

    function processModule(node)
    {
        let x = { 
            kind: (node.flags & ts.NodeFlags.Namespace) ? "namespace" : "module",
            name: node.name.getText(ast),
            members: postProcessMembers(node.body.statements.map(x => process(x))),
        }
        return x;
    }

    function processFunction(node)
    {
        return Object.assign({
            kind: "function",
            name: node.name.getText(ast),
        }, processCommon(node));
    }

    function processClass(node)
    {
        let x = Object.assign({
            kind: "class",
            name: node.name.getText(ast),
            members: postProcessMembers(node.members.map(x => process(x))),
        }, processCommon(node));

        // Combine get/set accessors
        let props = new Map();
        for (let i=0; i<x.members.length; i++)
        {
            let m = x.members[i];
            if (m.kind == "get" || m.kind == "set")
            {
                let key = m.name + (m.static ? "-static" : "");
                let prop = props.get(key);
                if (!prop)
                {
                    prop = {
                        kind: "property",
                        name: m.name,
                        static: m.static,
                    }
                    props.set(key, prop);
                    x.members.splice(i, 0, prop);
                    i++;
                }

                if (m.kind == "get")
                    prop.getAccessor = m;
                else
                    prop.setAccessor = m;
                x.members.splice(i, 1);
                i--;
            }
        }

        /*
        for (let [k,v] of props)
        {
            let def = "";
            if (v.getAccessor)
                def += v.getAccessor.definition + "\n";
            if (v.setAccessor)
                def += v.setAccessor.definition + "\n";
            if (v.getAccessor)
                v.jsdoc = v.getAccessor.jsdoc;
            if (v.setAccessor && !v.jsdoc)
                v.jsdoc = v.setAccessor.jsdoc;
            v.definition = def.trim();
        }
        */

        return x;
    }

    function processProperty(node)
    {
        let x = Object.assign({
            kind: "property",
            name: node.name.getText(ast),
        }, processCommon(node));
        return x;
    }

    function processConstructor(node)
    {
        let x = Object.assign({
            kind: "constructor",
        }, processCommon(node));
        return x;
    }

    function processMethod(node)
    {
        let x = Object.assign({
            kind: "method",
            name: node.name.getText(ast),
        }, processCommon(node));
        return x;
    }

    function processGetAccessor(node)
    {
        let x = Object.assign({
            kind: "get",
            name: node.name.getText(ast),
        }, processCommon(node));
        return x;
    }

    function processSetAccessor(node)
    {
        let x = Object.assign({
            kind: "set",
            name: node.name.getText(ast),
        }, processCommon(node));
        return x;
    }

    function processTypeAlias(node)
    {
        let x = Object.assign({
            kind: "type-alias",
            name: node.name.getText(ast),
//            type: process(node.type),
        }, processCommon(node));

        if (node.type.members)
        {
            x.members = node.type.members.map(x => process(x));
        }


        return x;
    }

    function processPropertySignature(node)
    {
        let x = Object.assign({
            kind: "property",
            name: node.name.getText(ast),
        }, processCommon(node));
        return x;
    }

    function processVariableStatement(node)
    {
        // This is a temporary placeholder and will be
        // flattened by postProcessMembers later
        let x = Object.assign({
            kind: "variables",
            declarations: node.declarationList.declarations.map(x => process(x)),
        }, processCommon(node));
        return x;
    }

    function processVariableDeclaration(node)
    {
        let x = Object.assign({
            kind: "let",
            name: node.name.getText(ast),
        }, processCommon(node));
        return x;
    }

    function processCommon(node)
    {
        let common = {};

        // Capture static flag
        let modifiers = ts.getCombinedModifierFlags(node);
        if (modifiers & ts.ModifierFlags.Static)
        {
            common.static = true;
        }

        // Capture definition
        common.definition = stripComments(source.code.substring(
            find_bol_ws(source.code, node.getStart(ast)),
            find_next_line_ws(source.code, node.end)
        )).trim();

        // Capture leading comments
        let documented = false;
        let comments = ts.getLeadingCommentRanges(source.code, node.pos);
        if (comments && comments.length > 0)
        {
            let comment = comments[comments.length-1];
            let commentText = source.code.substring(
                find_bol_ws(source.code, comment.pos),
                find_next_line_ws(source.code, comment.end)
            );
            common.jsdoc = parseJsDocComment(commentText);
            documented = !!common.jsdoc;

            // Check parameter names match
            if (documented && node.parameters)
            {
                let parameterNames = node.parameters.map(x => x.name.getText(ast));
                let parameterBlocks = common.jsdoc.filter(x => x.block == "param");
                for (let i=0; i<parameterBlocks.length; i++)
                {
                    if (!parameterNames.some(x => x == parameterBlocks[i].name))
                    {
                        console.error(`warning: ${format_position()}: @param block for unknown parameter '${parameterBlocks[i].name}'`);
                    }
                }
                for (let i=0; i<parameterNames.length; i++)
                {
                    if (!parameterBlocks.some(x => x.name == parameterNames[i]))
                    {
                        console.error(`warning: ${format_position()}: missing @param description for '${parameterNames[i]}'`);
                    }
                }
            }
        }

        if (!documented)
        {
            let name = node.name?.getText(ast) ?? "<unnamed element>";
            console.error(`warning: ${format_position()}: no documentation for ${name}`);
        }

        return common;

        function format_position()
        {
            let pos = node.getStart(ast);
            let lp = source.lineMap.fromOffset(pos);
            return `${lp.line}:${lp.column}`;
        }
    }
}

