import ts from 'typescript';
import { SourceFile } from "./SourceFile.js";

export function isDeclarationNode(node)
{
    switch (node.kind)
    {
        case ts.SyntaxKind.ClassDeclaration:
        case ts.SyntaxKind.FunctionDeclaration:
        case ts.SyntaxKind.VariableDeclaration:
        case ts.SyntaxKind.VariableDeclarationList:
        case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.PropertyDeclaration:
        case ts.SyntaxKind.GetAccessor:
        case ts.SyntaxKind.SetAccessor:
            return true;
    }
    return false;
}


export function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

export function regExpForName(name) {
    let rx = "";
    if (!name.startsWith("$"))
        rx += "\\b";
    rx += escapeRegExp(name);
    if (!name.endsWith("$"))
        rx += "\\b";
    return rx;
}



let lastOriginalFileName = null;
let lastOriginalFile;
export function loadOriginalFile(sourceFileName)
{
    if (lastOriginalFileName == sourceFileName)
        return lastOriginalFile;

    lastOriginalFileName = sourceFileName;
    lastOriginalFile = SourceFile.fromFile(sourceFileName);
    return lastOriginalFile;
}


export function isExport(node)
{
    return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) != 0;
}

export function stripQuotes(str)
{
    if ((str.startsWith("\"") && str.endsWith("\"")) ||
        (str.startsWith("\'") && str.endsWith("\'")))
        str = str.substring(1, str.length - 1);
    return str;
}

export function isPrivateOrInternal(ast, node)
{
    if ((ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Private) != 0)
        return true;
    if (ts.isInternalDeclaration(node, ast))
        return true;

    return false;
}