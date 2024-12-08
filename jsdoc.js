import { find_bol_ws, find_next_line_ws } from "./textUtils.js";

export function trimCommonLeadingSpace(str) {

    // Split the string into lines
    let lines = str.split('\n');

    let common = null;
    for (let l of lines)
    {
        // Get leading space for this line
        let linespace = l.match(/^([ \t]*)/);
        if (!linespace)
            return str;

        // Ignore completely whitespace lines
        if (linespace[1].length == l.length)
            continue;

        if (common == null)
        {
            common = linespace[1];
        }
        else
        {
            for (let i=0; i < common.length; i++)
            {
                if (linespace[1][i] != common[i])
                {
                    common = common.substring(0, i);
                    break;
                }
            }
        }
    }

    if (!common || common.length == 0)
        return str;

    lines = lines.map(x => x.substring(common.length));


    // Join the lines back into a single string
    return lines.join('\n');
}


export function stripComments(str)
{
    let rx = /(?:(?:\/\*[\s\S]*?\*\/)|(?:\/\/.*))/g
    let match;
    let ranges = [];
    while (match = rx.exec(str))
    {
        ranges.unshift({ pos: match.index, end: rx.lastIndex });
    }
    for (let r of ranges)
    {
        let pos = find_bol_ws(str, r.pos);
        let end = find_next_line_ws(str, r.end);
        str = str.substring(0, pos) + str.substring(end);
    }
    return str;
}

const defaultBalancedPairs = {
    "<": ">",
    "(": ")",
    "[": "]",
    "{": "}",
}

export function tokenizer(str, pos)
{
    if (!pos)
        pos = 0;
    let len = str.length;

    function readChar()
    {
        if (pos < len)
            return str[pos++];
        return undefined;
    }

    function find(rx)
    {
        if (typeof(rx) === 'string')
            rx = new RegExp(rx, 'y');
        else if (rx.flags.indexOf('g') < 0)
            rx = new RegExp(rx.source, rx.flags + "g");

        rx.lastIndex = pos;
        let rxm = rx.exec(str);
        if (!rxm)
            return undefined;

        pos = rxm.index;
        return rxm;
    }

    function readRegExp(rx)
    {
        if (typeof(rx) === 'string')
            rx = new RegExp(rx, 'y');
        else if (rx.flags.indexOf('y') < 0)
            rx = new RegExp(rx.source, rx.flags + "y");
        
        rx.lastIndex = pos;
        let rxm = rx.exec(str);
        if (!rxm)
            return undefined;

        pos += rxm[0].length;

        return rxm;
    }

    function match(rx)
    {
        if (typeof(rx) === 'string')
            rx = new RegExp(rx, 'y');
        else if (rx.flags.indexOf('y') < 0)
            rx = new RegExp(rx.source, rx.flags + "y");
        
        rx.lastIndex = pos;
        let rxm = rx.exec(str);
        if (!rxm)
            return undefined;

        return rxm;
    }

    function readWhitespace()
    {
        return readRegExp(/\s*/y)[0];
    }

    function readIdentifier()
    {
        let id = readRegExp(/[a-zA-Z_$][a-zA-Z0-9_$]*/y);
        return id ? id[0] : undefined;
    }

    function readString()
    {
        if (str[pos] != '\"' && str[pos] != '\'' && str[pos] != '`')
            return undefined;
        
        let start = pos;
        let delim = str[pos++];

        let decoded = "";

        while (pos < len && str[pos] != delim)
        {
            if (str[pos] == '\\')
            {
                pos++;
                switch (str[pos])
                {
                    case '\\': decoded += '\\'; pos++; break;
                    case '\'': decoded += '\''; pos++; break;
                    case '\"': decoded += '\"'; pos++; break;
                    case 't': decoded += '\t'; pos++; break;
                    case 'r': decoded += '\r'; pos++; break;
                    case 'n': decoded += '\n'; pos++; break;
                    case '0': decoded += '\0'; pos++; break;
                    default:
                        decoded += "\\";
                        pos--;
                        break;
                }
                continue;
            }
            
            decoded += str[pos++];
        }

        if (str[pos] != delim)
        {
            pos = start;
            return undefined;
        }

        pos++;
        return {
            raw: str.substring(start, pos),
            value: decoded,
        };
    }



    function readBraced()
    {
        if (str[pos] != '{')
            return undefined;
    
        let start = pos;
        pos++;

        let braced = "";
        let depth = 0;
        while (pos < len)
        {
            // Nested string?
            let ss = readString();
            if (ss)
            {
                braced += ss.raw;
                continue;
            }

            // Escaped closing brace?
            if (str[pos] == '\\' && str[pos+1] == '}')
            {
                braced += "}";
                pos+=2;
                continue;
            }

            if (str[pos] == '{')
                depth++;
            if (str[pos] == '}')
            {
                if (depth)
                    depth--;
                else
                    break;
            }
            braced += str[pos];
            pos++;
        }

        if (str[pos] != '}')
        {
            pos = start;
            return undefined;
        }

        pos++;
        return {
            raw: str.substring(start, pos),
            value: braced,
        }

    }

    function readBalanced(pairs)
    {
        // Use default pairs
        if (!pairs)
            pairs = defaultBalancedPairs;

        // Must start with a pair
        if (!pairs[str[pos]])
            return undefined;

        let stack = [ str[pos] ];
        let start = pos;
        pos++;

        let value = "";
        while (pos < len)
        {
            // Nested string?
            let ss = readString();
            if (ss)
            {
                value += ss.raw;
                continue;
            }

            if (pairs[str[pos]])
            {
                stack.unshift(str[pos]);
            }
            else if (str[pos] == pairs[stack[0]])
            {
                stack.shift();
                if (stack.length == 0)
                {
                    pos++;
                    return str.substring(start, pos);
                }
            }

            value += str[pos++];
        }

        pos = start;
        return undefined;
    }

    function read(value)
    {
        if (str.substring(pos, pos + value.length) == value)
        {
            pos += value.length;
            return value;
        }
        return undefined;
    }

    function readLineEnd()
    {
        if ((str[pos] == '\r' && str[pos + 1] == '\n') || 
            (str[pos] == '\n' && str[pos + 1] == '\r'))
        {
            pos +=2;
            return str.substring(pos-2, pos);
        }

        if (str[pos] == '\r' || str[pos] == '\n')
        {
            pos++;
            return str[pos-1];
        }

        return undefined;
    }

    function readToEndOfLine()
    {
        let start = pos;
        while (pos < len && str[pos] != '\r' && str[pos] != '\n')
            pos++;
        return str.substring(start, pos);
    }

    function readToNextLine()
    {
        let rest = readToEndOfLine();
        let le = readLineEnd();
        if (le)
            return rest + le;
        else
            return rest;
    }

    return {
        find,
        match,
        readChar,
        readRegExp,
        readWhitespace,
        readIdentifier,
        readString,
        readBalanced,
        read,
        readToEndOfLine,
        readLineEnd,
        readToNextLine,
        substring(start, end) { return str.substring(start, end); },
        get tail()
        {
            return str.substring(pos);
        },
        get current()
        {
            return str[pos];
        },
        get pos()
        {  
            return pos;
        },
        set pos(value)
        {
            pos = value;
        },
        get eof()
        {
            return pos >= len;
        }
    }
}

export function parseNameSpecifier(t)
{
    t.readWhitespace();

    let optional = !!t.read("[");
    let start = t.pos;

    t.readWhitespace();
    let name = t.readIdentifier();
    if (!name)
        return undefined;

    while (true)
    {
        t.readWhitespace();

        if (t.read("["))
        {
            t.readWhitespace();
            if (!t.read("]"))
                return undefined;
            continue;
        }
        if (t.read("."))
        {
            t.readWhitespace();
            if (!t.readIdentifier())
                return undefined;
            continue;
        }

        break;
    }

    let result = {
        optional,
        name: name,
        specifier: t.substring(start, t.pos).trim(),
    }


    if (optional)
    {
        t.readWhitespace();
        if (t.read("="))
        {
            t.readWhitespace();

            let defStart = t.pos;
            while (t.current != ']')
            {
                if (t.eof)
                    return undefined;
                if (!t.readBalanced())
                    t.readChar();
            }
            result.default = t.substring(defStart, t.pos);
        }

        if (!t.read("]"))
            return undefined;
    }

    return result;
}

export function parseJsDocComment(str)
{
    str = trimCommonLeadingSpace(str);
    
    let end = str.match(/(?:(?:^\s*\*\/)|(?:\*\/))/m);
    if (end < 0)
        return undefined;

    // Create tokenizer
    let t = tokenizer(str.substring(0, end.index));

    // Skip whitespace
    t.readWhitespace();

    // Skip opening comment
    if (!t.readRegExp(/\/\*\* ?/y))
        return null;

    let section = {
        kind: null,
        text: "",
    }
    let sections = [ section ];
    while (!t.eof)
    {
        // Read a line
        section.text += t.readToNextLine();

        // Skip leading *
        t.readRegExp(/\s*\* ?/y);

        // Is it a directive?
        let directive = t.readRegExp(/\s*@([a-zA-Z][a-zA-Z0-9_$]*) ?/y);
        if (directive)
        {
            t.readWhitespace();

            // Create a new section
            section = {
                block: directive[1],
                text: "",
            };
            sections.push(section);

            // Alias
            if (section.block == 'arg' || section.block == 'argument')
                section.block = "param";
            if (section.block == 'prop')
                section.block = "parameter";

            // Does it have a type specifier 
            if (section.block.match(/param|return|returns|property/))
            {
                if (t.current == '{')
                {
                    let type = t.readBalanced();
                    if (!type)
                    {
                        let err = new Error("syntax error parsing JSDoc - missing '}'")
                        err.offset = t.pos;
                        throw err;
                    }
                    section.type = type.substring(1, type.length - 1);
                    t.readWhitespace();
                }
            }

            // Does it have a name
            if (section.block.match(/param|property/))
            {
                Object.assign(section, parseNameSpecifier(t));
                t.readWhitespace();
            }
        }
    }

//    console.log(JSON.stringify(sections, null, 2));
    return sections;
}

export function escapeNamePathElement(name)
{
    // Does it have special characters
    if (!name.match(/[^a-zA-Z0-9_$@/]/))
        return name;

    return `"${name.replace(/"/g, "\\\"")}\"`;
}

function parseNamePath(t)
{
    let start = t.pos;
    let namepath = [];
    let delim = undefined;
    while (true)
    {
        // Prefix
        let prefix = t.readRegExp(/([a-zA-Z]+):/);
        if (prefix)
            prefix = prefix[0];
        else
            prefix = undefined;

        // Escaped string part?
        let str = t.readString();
        if (str)
        {
            namepath.push({
                prefix,
                delim,
                name: str.value
            });
        }
        else
        {
            // Normal identifier?
            let id = t.readIdentifier();
            if (id)
            {
                namepath.push({
                    prefix,
                    delim,
                    name: id
                });
            }
            else
            {
                break;
            }
        }
        
        // Delimiter
        delim = t.readRegExp(/[#.~]/y);
        if (delim)
        {
            delim = delim[0];
            continue;
        }

        // End of name path?
        if (t.match(/[| \t\}]/y))
            return namepath;

        // Unknown, not a name path
        break;
    }

    t.pos = start;
    return null;
}

/** 
 * Parses inlines
 * @param {string} body The body of the comment
 */
export function parseJsdocInline(body)
{
    let t = tokenizer(body);

    let links = [];

    // {@
    while (t.find(/\{@/g))
    {
        let linkPos = t.pos;

        t.pos += 2;

        // link | linkplain | linkcode
        let kind = t.readRegExp("link|linkplain|linkcode\b");
        if (!kind)
            continue;
        kind = kind[0];

        // Whitespace
        t.readWhitespace();

        // Try to parse as a namepath
        let url = undefined;
        let namepath = parseNamePath(t);
        if (!namepath)
        {
            url = t.readRegExp(/[^ \t\}\|]+/y);
            if (!url)
                continue;
            url = url[0];
        }

        // Skip optional separator
        t.readWhitespace();
        if (t.current == '|')
            t.pos++;
        t.readWhitespace();

        // Read title
        let title = t.readRegExp(/[^\}]*/y);
        if (title)
            title = title[0].trim();
        if (title.length == 0)
            title = undefined;

        // Skip delimiter
        if (t.current != '}')
            continue;
        t.pos++;

        // Store link
        links.push({
            pos: linkPos,
            end: t.pos,
            kind,
            title,
            url,
            namepath,
        });
    }

    return links;
}


export function replaceJsdocInline(body)
{
    let links = parseJsdocInline(body);
    let buf = "";
    let pos = 0;
    for (let i=0; i<links.length; i++)
    {
        let l = links[i];
        if (l.pos > pos)
            buf += body.substring(pos, l.pos);

        buf += `{@link ${i}}`;
        pos = l.end;
    }
    buf += body.substring(pos);

    return {
        body: buf,
        links,
    }
}


export function formatNamePath(np)
{
    let str = "";
    for (let n of np)
    {
        if (n.delimiter)
            str += n.delimiter;
        if (n.prefix)
            str += n.prefix;
        str += escapeNamePathElement(n.name);
    }
    return str;
}
