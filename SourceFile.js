import fs from 'node:fs';
import path from 'node:path';
import { SourceMapConsumer } from '@jridgewell/source-map';
import { LineMap } from "./LineMap.js";

export class SourceFile
{
    constructor(code, sourceMap)
    {
        this.code = code;
        this.sourceMap  = sourceMap;
        this.lineMap = this.code ? new LineMap(this.code, { lineBase : 1}) : null;
    }



    static fromFile(sourceFile, mapFile)
    {
        // Read the source
        let code;
        if (sourceFile)
        {
            code = fs.readFileSync(sourceFile, "utf8");
        }

        // Work out map file
        if (!mapFile && code)
        {
            let mapName = /\/\/# sourceMappingURL=(.*)$/m.exec(code);
            if (mapName)
            {                
                mapFile = path.join(path.dirname(path.resolve(sourceFile)), mapName[1]);
            }
        }

        // Load map
        let sourceMap;
        if (mapFile)
        {
            sourceMap = new SourceMapConsumer(JSON.parse(fs.readFileSync(mapFile, "utf8")));
        }

        // Create source file
        return new SourceFile(code, sourceMap);
    }
}