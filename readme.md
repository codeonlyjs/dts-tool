# dts-tool

`dts-tool` is a tool that tries to fix the mess that's produced by 
the TypeScript compiler when generating `.d.ts` files from `.js` files.



## Background

Let's say you have a JavaScript library and you want to generate the
`.d.ts` file that drives VS Codes IntelliSense.  You can use use
the TypeScript compiler to produce the `.d.ts` and it'll glean quite
a bit of information both from the code itself and from JSDoc comments.  Great!  

But it has problems...

Suppose your library is configured like this pretty typical setup:

`index.js`, the main entry point into library:

```js
export * from "./foo.js";
export * from "./bar.js";
```

`foo.js`:

```js
/** This is the foo function */
export function foo()
{
}
```

and `bar.js`:

```js
/** This is the bar function */
export function bar()
{
}
```

To generate the `.d.ts` file you can setup a `tsconfig.json` like this:

```json
{
  "include": [
    "index.js",
  ],
  "compilerOptions": {
    "allowJs": true,
    "declaration": true,
    "emitDeclarationOnly": true,
    "outFile": "index.d.ts",
    "declarationMap": true,
  }
}
```

and run `tsc --project tsconfig.emit.json`.  `tsc` to produce this `index.d.ts` file:

```typescript
declare module "foo" {
    /** This is the foo function */
    export function foo(): void;
}
declare module "bar" {
    /** This is the bar function */
    export function bar(): void;
}
declare module "index" {
    export * from "foo";
    export * from "bar";
}
//# sourceMappingURL=index.d.ts.map
```

Unfortunately it doesn't work and is kind of useless because it has
created modules for all of your source files.

For example, when adding imports, VS Code adds:

```js
import { foo } from "foo";
```

instead of (assuming your library package name is `@myscope/mylib`)

```js
import { foo } from "@myscope/mylib";
```


What we really need is a `.d.ts` file like this:

```typescript
declare module "@myscope/mylib" {
    /** This is the foo function */
    export function foo(): void;

    /** This is the bar function */
    export function bar(): void;
}
```

## Other Problems

There's other problems too:

* The source map is so wacky it's almost unusable.
* If a file import types from another, there will be import
  declarations in the `.d.ts` file that need to be cleaned up.
* The `tsc` compiler is supposed to be able to omit declarations
  marked as `@internal` - but it doesn't work for .js files.
* There's no module with the name of the package, so adding import
  declarations in VS Code doesn't work.

## The Solution (Maybe)

So `dts-tool` tries to sort out the mess.  You still generate the
original `.d.ts` file as described above, but then you feed it 
into `dts-tool`:

```
npx codeonlyjs/dts-tool demod index.d.ts @myscope/mylib --strip-internal
```

This will:

* Combine all the declared modules into one module with the name 
  `@myscope/mylib`
* Remove any `import` and `export` statements that are no longer 
  required because everything is now one big happy module.
* Fix the source mapping.  OMG! The `tsc` source maps are hopeless.
* Removes any `@callback` and `@typedef` comment blocks because
  they've already been processed by `tsc` and have types generated 
  so are no longer useful.
* Removes any declarations that are marked `@internal` (if
  `--strip-internal` used)


## Other Tools

In order to get this working I also needed some utility tools
mainly related to working with source maps.  Run with `--help` 
to see some other commands.


## Related StackOverflow Question

Question asked here:

https://stackoverflow.com/questions/79253449/how-to-correctly-generate-d-ts-files-for-library-package