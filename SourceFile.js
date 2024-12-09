import fs from 'node:fs';
import path from 'node:path';
import { SourceMapConsumer } from '@jridgewell/source-map';
import { LineMap } from "./LineMap.js";

/**
 * Manages the content of a read-only source file
 * providing both source mapping and 
 * offset/line/column mapping
 */
export class SourceFile
{
    /**
     * Constructs a new SourceFile
     * @param {string} filename The name of the file this source file was loaded from
     * @param {string} code The code content of the file
     * @param {SourceMapConsumer} sourceMap The loaded and parsed source map for the file
     */
    constructor(filename, code, sourceMap)
    {
        /**
         * The name of the file this source file was loaded from
         */
        this.filename = filename;
        /**
         * The code content of the file
         * @type {string}
         */
        this.code = code;

        /**
         * The source map for this file
         * @type {SourceMapConsumer}
         */
        this.sourceMap  = sourceMap;

        /**
         * The line number map for this file
         * @type {LineMap}
         */
        this.lineMap = this.code ? new LineMap(this.code, { lineBase : 1}) : null;
    }

    /**
     * Loads a source file and it's .map file
     * @param {string} sourceFileName Filename of the file to load
     * @param {string} mapFile Filename of the .map file to load.  Leave null to use name from source file.
     * @returns {SourceFile}
     */
    static fromFile(sourceFileName, mapFile)
    {
        // Read the source
        let code;
        if (sourceFileName)
        {
            code = fs.readFileSync(sourceFileName, "utf8");
        }

        // Work out map file
        if (!mapFile && code)
        {
            let mapName = /\/\/# sourceMappingURL=(.*)$/m.exec(code);
            if (mapName)
            {                
                mapFile = path.join(path.dirname(path.resolve(sourceFileName)), mapName[1]);
            }
        }

        // Load map
        let sourceMap;
        if (mapFile)
        {
            sourceMap = new SourceMapConsumer(JSON.parse(fs.readFileSync(mapFile, "utf8")));
        }

        // Create source file
        return new SourceFile(sourceFileName, code, sourceMap);
    }
}