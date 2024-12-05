import { binarySearch } from "./binarySearch.js";

export class LineMap
{
    constructor(str, options)
    {
        // Store the total length
        this.totalLength = str.length;

        this.options = Object.assign({
            lineBase: 0,
            columnBase: 0,
        }, options);

        // Build a list of the offsets at the start of all lines
        this.lineOffsets = [ 0 ];
        for (let i = 0; i < str.length; i++)
        {
            if (str[i] == '\r' && i + 1 < str.length && str[i + 1] == '\n')
                i++;

            if (str[i] == '\n' || str[i] == '\r')
            {
                this.lineOffsets.push(i + 1);
            }
        }
    }

    fromOffset(offset)
    {
        // Do a binary search for the line
        let lineNumber = binarySearch(this.lineOffsets, (a, b) => a - b, offset);
        if (lineNumber < 0)
            lineNumber = (-lineNumber-1);
        else
            lineNumber++;

        if (lineNumber < this.lineOffsets.length)
        {
            return { 
                line: this.options.lineBase + lineNumber - 1, 
                column: this.options.columnBase + offset - this.lineOffsets[lineNumber - 1] 
            }
        }
        else
        {
            return {
                line: this.options.lineBase + this.lineOffsets.length - 1,
                column: this.options.columnBase + offset - this.lineOffsets[this.lineOffsets.length-1],
            }
        }
    }

    toOffset(line, column)
    {
        line -= this.options.lineBase;
        column -= this.options.columnBase;
        if (line > this.lineOffsets.length)
            return this.totalLength;
        let offset = this.lineOffsets[line] + column;
        if (offset > this.totalLength)
            offset = this.totalLength;
        return offset;
    }
}

export function find_bol_ws(str, from)
{
    while (from > 0)
    {
        if (str[from-1] != ' ' && str[from-1] != '\t')
            break;
        from--;
    }
    return from;
}

export function find_eol_ws(str, from)
{
    while (from < str.length)
    {
        if (str[from] != ' ' && str[from] != '\t')
            break;
        from++;
    }
    return from;
}

export function skip_eol(str, from)
{
    if (str[from] == '\r' && str[from] == '\n')
        return from + 2;
    if (str[from] == '\n' && str[from] == '\r')
        return from + 2;
    if (str[from] == '\n')
        return from + 1;

    return from;
}

export function find_next_line_ws(str, from)
{
    return skip_eol(str, find_eol_ws(str, from));
}