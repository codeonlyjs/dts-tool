import fs from 'node:fs';
import path from 'node:path';
import { SourceMapConsumer, SourceMapGenerator } from "@jridgewell/source-map";
import { LineMap } from "./LineMap.js";
import { binarySearch } from './binarySearch.js';

/**
 * @typedef MappedPoint
 * @property {number} offset Offset in the source file
 * @property {string} source Original source file
 * @property {string} name Name of the mapped location
 * @property {number} originalLine Original line number (1 based)
 * @property {number} originalColumn Original column number (0 based)
 */

/**
 * Manages a chunk of source code with an associated set of
 * mapping points.  Provides methods for insert/deleting etc
 * in the source code while keeping the mapping points up to
 * date.  Also supports inserting other MappedSource objects
 * in which case a combined set of mapped points is generated.
 */
export class MappedSource
{
    /**
     * Constructs a new MappedSource
     * @param {string} source
     * @param {MappedPoint[]} map
     */
    constructor(source, map)
    {
        this.source = source ?? "";
        this.map = map ?? [];
    }

    /**
     * Save the source code and the .map
     * @returns {void}
     */
    save(filename)
    {
        let mapfile = filename + ".map";

        // Write the final source file
        let finalSource = `${this.source}\n//# sourceMappingURL=${mapfile}\n`;
        fs.writeFileSync(filename, finalSource, "utf8");

        // Create line map
        let lm = new LineMap(this.source, { lineBase: 1});

        // Generate mapping
        let smg = new SourceMapGenerator({
            file: filename,
            sourceRoot: "",
        });

        // Add mappings
        for (let m of this.map)
        {
            smg.addMapping({
                generated: lm.fromOffset(m.offset),
                source: m.source,
                original: { line: m.originalLine, column: m.originalColumn },
                name: m.name
            });
        }
        let json = smg.toJSON();
        delete json.sourcesContent;
        json.names = [];
        fs.writeFileSync(mapfile, JSON.stringify(json, null, 2), "utf8");
    }

    /**
     * Create a MappedSource object
     * @param {string} file The source file to load
     * @returns {MappedSource}
     */
    static FromSourceFile(file)
    {  
        // Read the source file
        let source = fs.readFileSync(file, "utf8");

        // Find the source map name
        let map = null;
        let mapName = /\/\/# sourceMappingURL=(.*)$/m.exec(source);
        if (mapName)
        {
            source = source.substring(0, mapName.index) + 
                     source.substring(mapName.index + 1 + mapName[0].length);
            let fullMapName = path.join(path.dirname(path.resolve(file)), mapName[1]);
            let smc = new SourceMapConsumer(JSON.parse(fs.readFileSync(fullMapName, "utf8")));
            map = [];
            let lm = new LineMap(source, { lineBase: 1 });
            smc.eachMapping(x => {
                map.push({
                    offset: lm.toOffset(x.generatedLine, x.generatedColumn),
                    name: x.name,
                    source: x.source,
                    originalLine: x.originalLine,
                    originalColumn: x.originalColumn,
                });
            });
        }

        // Create MappedSource
        return new MappedSource(source, map);
    }

    /** 
     * Take a slice as a new MappedSource returning a new
     * MappedSource instance representing the slice
     * @param {number} start Starting offset
     * @param {number} end Ending offset
     * @returns {MappedSource}
     */
    substring(start, end)
    {
        let source = this.source.substring(start, end);
        let map = this.map
            .filter(x => x.offset >= start && x.offset <= end)
            .map(x => {
                let n = Object.assign({}, x);
                n.offset -= start;
                return n;
            });

        return new MappedSource(source, map);
    }

    /**
     * Splice into this MappedSource
     * @param {number} offset Offset at which to splice
     * @param {number} length Number of characters to delete
     * @param {string | MappedSource} string String or MappedSource instance to insert at offset
     * @returns {void}
     */
    splice(offset, length, string)
    {
        if (offset < 0)
            throw new Error("invalid splice offset");
        if (offset + length > this.source.length)
            throw new Error("invalid splice end offset");
            
        // Is it a map?
        let map = null;
        if (string instanceof MappedSource)
        {
            map = string.map;
            string = string.source;
        }

        // Update the string
        this.source = 
            this.source.substring(0, offset) 
            + string 
            + this.source.substring(offset + length);

        // Update the map
        for (let i=0; i<this.map.length; i++)
        {
            let m = this.map[i];
            if (m.offset >= offset)
            {
                if (m.offset < offset + length)
                {
                    this.map.splice(i, 1);
                    i--;
                }
                else
                {
                    m.offset += string.length - length;
                }
            }
        }

        // Insert the map
        if (map && map.length)
        {
            // Work out insert position
            let insPos = binarySearch(this.map, (a, b) => a - b, map[0].offset + offset);
            if (insPos < 0)
                insPos = -insPos - 1;

            // Create new map entries
            let mapEntries = map.map(x => {
                let n = Object.assign({}, x);
                n.offset += offset;
                return n;
            });

            // Insert them
            this.map.splice(insPos, 0, ...mapEntries);
        }
    }

    /**
     * Insert into this MappedSource
     * @param {number} offset Offset at which to splice
     * @param {string | MappedSource} string String or MappedSource instance to insert at offset
     * @returns {void}
     */
    insert(offset, string)
    {
        this.splice(offset, 0, string);
    }

    /**
     * Delete parts of  this MappedSource
     * @param {number} offset Offset at which to splice
     * @param {number} length Number of characters to delete
     * @returns {void}
     */
    delete(offset, length)
    {
        this.splice(offset, length, "");
    }

    /**
     * Append to this MappedSource
     * @param {string | MappedSource } str The string to append
     * @returns {void}
     */
    append(str)
    {
        this.splice(this.source.length, 0, str);
    }

}