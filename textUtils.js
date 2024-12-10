
/**
 * Find the begining of a line, only skipping over white-space
 * @param {string} str The string to scan
 * @param {number} from The starting index
 * @returns {number}
 */
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

/**
 * Find the end of a line, only skipping over white-space
 * @param {string} str The string to scan
 * @param {number} from The starting index
 * @returns {number}
 */
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

/**
 * Skip EOL character(s) in a string
 * @param {string} str The string to scan
 * @param {number} from The starting index
 * @returns {number}
 */
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

/**
 * Find the next line, only skipping white-space
 * @param {string} str The string to scan
 * @param {number} fromt The starting index
 * @returns {number}
 */
export function find_next_line_ws(str, from)
{
    return skip_eol(str, find_eol_ws(str, from));
}