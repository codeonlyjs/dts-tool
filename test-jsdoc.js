import { strict as assert } from "node:assert";
import { test } from "node:test";
import { 
tokenizer, 
stripComments, parseJsDocComment,
parseNameSpecifier,
escapeNamePathElement,
parseJsdocInline,
replaceJsdocInline
} from "./jsdoc.js";


test("tokenizer (tail)", () => {

    let t = tokenizer("Hello World", 6);

    assert.equal(t.tail, "World");

});


test("tokenizer (whitespace)", () => {

    let t = tokenizer("     Hello World", 0);
    t.readWhitespace();

    assert.equal(t.tail, "Hello World");

});


test("tokenizer (identifier)", () => {

    let t = tokenizer("     _Hello99$ World", 0);

    t.readWhitespace();
    let id = t.readIdentifier();
    assert.equal(id, "_Hello99$");

});

test("tokenizer (string)", () => {

    let t = tokenizer("'Hello\\tWorld'", 0);

    let str = t.readString();
    assert.equal(str.raw, "'Hello\\tWorld'");
    assert.equal(str.value, "Hello\tWorld");
});

test("tokenizer (braced)", () => {

    let t = tokenizer("{{there}}", 0);

    let val = t.readBalanced();
    assert.equal(val, "{{there}}");
});


test("strip comments (block)", () => {

    let str = `
    before
    /* this is a comment 
Multi
line
comment */
    between
    /* this is also a comment */
    after
`;
    let clean = stripComments(str);
    assert.equal(clean, `
    before
    between
    after
`);
});

test("strip comments (singleline)", () => {

    let str = `
    before
    // this is a comment 
    between
    // so is this
    after
`;
    let clean = stripComments(str);
    assert.equal(clean, `
    before
    between
    after
`);
});

test("tokenize jsdoc", () => {

    let sections = parseJsDocComment(`   /** This is 
 * the description
 * as is this
 * @param {paramType} paramName parameter description
 * param desc continued
 * @returns {retType} description
 * also continues
 */
`);

    assert.equal(sections.length, 3);
    assert.deepEqual(sections[0], {
        kind: null,
        text: `This is 
the description
as is this
`,
    });
    assert.deepEqual(sections[1], {
        block: "param",
        type: "paramType",
        optional: false,
        name: "paramName",
        specifier: "paramName",
        text: `parameter description
param desc continued
`,
    });

    assert.deepEqual(sections[2], {
        block: "returns",
        type: "retType",
        text: `description
also continues
`,
    });
});

test("tokenize name specifier (simple)", () => {
    assert.deepEqual(parseNameSpecifier(tokenizer("name")), {
        optional: false,
        name: "name",
        specifier: "name"
    });
});


test("tokenize name specifier (with property)", () => {
    assert.deepEqual(parseNameSpecifier(tokenizer("name.property")), {
        optional: false,
        name: "name",
        specifier: "name.property"
    });
});

test("tokenize name specifier (array)", () => {
    assert.deepEqual(parseNameSpecifier(tokenizer("name[]")), {
        optional: false,
        name: "name",
        specifier: "name[]"
    });
});

test("tokenize name specifier (array with property)", () => {
    assert.deepEqual(parseNameSpecifier(tokenizer("name[].prop")), {
        optional: false,
        name: "name",
        specifier: "name[].prop"
    });
});

test("tokenize name specifier (optional)", () => {
    assert.deepEqual(parseNameSpecifier(tokenizer("[name]")), {
        optional: true,
        name: "name",
        specifier: "name"
    });
});

test("tokenize name specifier (optional, with default)", () => {
    assert.deepEqual(parseNameSpecifier(tokenizer("[name=99]")), {
        default: "99",
        optional: true,
        name: "name",
        specifier: "name"
    });
});

test("tokenize name specifier (optional, with string value)", () => {
    assert.deepEqual(parseNameSpecifier(tokenizer("[name='[hello]']")), {
        default: "'[hello]'",
        optional: true,
        name: "name",
        specifier: "name"
    });
});

test("tokenize name specifier (optional, with array value)", () => {
    assert.deepEqual(parseNameSpecifier(tokenizer("[name=[1,2,3]]")), {
        default: "[1,2,3]",
        optional: true,
        name: "name",
        specifier: "name"
    });
});

test("tokenize name specifier (multiple props)", () => {
    assert.deepEqual(parseNameSpecifier(tokenizer("foo.bar.baz")), {
        optional: false,
        name: "foo",
        specifier: "foo.bar.baz"
    });
});

test("escape namepath (plain)", () => {
    assert.equal(escapeNamePathElement("plain_123$"), "plain_123$");
});

test("escape namepath (.)", () => {
    assert.equal(escapeNamePathElement("23.12"), `"23.12"`);
});

test("escape namepath (#)", () => {
    assert.equal(escapeNamePathElement("elem#id"), `"elem#id"`);
});

test("escape namepath (\")", () => {
    assert.equal(escapeNamePathElement("\"Hello World\""), `"\\\"Hello World\\\""`);
});

test("parse inline", () => {

    let r = parseJsdocInline("Hello {@link http://localhost/blah World}");
    assert.deepEqual(r, [
        {
            pos: 6,
            end: 41,
            kind: "link",
            namepath: null,
            url: "http://localhost/blah",
            title: "World",
        }
    ]);
});

test("parse inline multiple", () => {

    let r = parseJsdocInline("pre {@link prop} between {@link prop2} after");
    assert.deepEqual(r, [
        {
            pos: 4,
            end: 16,
            kind: "link",
            namepath: [
                { delim: undefined, prefix: undefined, name: "prop" }
            ],
            url: undefined,
            title: undefined,
        },
        {
            pos: 25,
            end: 38,
            kind: "link",
            namepath: [
                { delim: undefined, prefix: undefined, name: "prop2" }
            ],
            url: undefined,
            title: undefined,
        }
    ]);
});

test("parse inline module", () => {

    let r = parseJsdocInline("pre {@link module:prop} post");
    assert.deepEqual(r, [
        {
            pos: 4,
            end: 23,
            kind: "link",
            namepath: [
                { delim: undefined, prefix: "module:", name: "prop" }
            ],
            url: undefined,
            title: undefined,
        },
    ]);
});

test("parse inline string", () => {

    let r = parseJsdocInline(`pre {@link "item"} post`);
    assert.deepEqual(r, [
        {
            pos: 4,
            end: 18,
            kind: "link",
            namepath: [
                { delim: undefined, prefix: undefined, name: "item" }
            ],
            url: undefined,
            title: undefined,
        },
    ]);
});

test("parse inline delimited", () => {

    let r = parseJsdocInline(`pre {@link a.b#c~d#event:e} post`);
    assert.deepEqual(r, [
        {
            pos: 4,
            end: 27,
            kind: "link",
            namepath: [
                { delim: undefined, prefix: undefined, name: "a" },
                { delim: ".", prefix: undefined, name: "b" },
                { delim: "#", prefix: undefined, name: "c" },
                { delim: "~", prefix: undefined, name: "d" },
                { delim: "#", prefix: "event:", name: "e" }
            ],
            url: undefined,
            title: undefined,
        },
    ]);
});

test("parse inline namepath | title", () => {

    let r = parseJsdocInline(`pre {@link a | My Title } post`);
    assert.deepEqual(r, [
        {
            pos: 4,
            end: 25,
            kind: "link",
            namepath: [
                { delim: undefined, prefix: undefined, name: "a" },
            ],
            url: undefined,
            title: "My Title",
        },
    ]);
});

test("parse inline namepath title", () => {

    let r = parseJsdocInline(`pre {@link a My Title } post`);
    assert.deepEqual(r, [
        {
            pos: 4,
            end: 23,
            kind: "link",
            namepath: [
                { delim: undefined, prefix: undefined, name: "a" },
            ],
            url: undefined,
            title: "My Title",
        },
    ]);
});

test("parse inline namepath|title", () => {

    let r = parseJsdocInline(`pre {@link a|My Title } post`);
    assert.deepEqual(r, [
        {
            pos: 4,
            end: 23,
            kind: "link",
            namepath: [
                { delim: undefined, prefix: undefined, name: "a" },
            ],
            url: undefined,
            title: "My Title",
        },
    ]);
});


test("parse inline multiple", () => {

    let r = replaceJsdocInline("pre {@link prop} between {@link prop2} after");
    assert.deepEqual(r, {
        body: "pre {@link 0} between {@link 1} after",
        links: [
            {
                pos: 4,
                end: 16,
                kind: "link",
                namepath: [
                    { delim: undefined, prefix: undefined, name: "prop" }
                ],
                url: undefined,
                title: undefined,
            },
            {
                pos: 25,
                end: 38,
                kind: "link",
                namepath: [
                    { delim: undefined, prefix: undefined, name: "prop2" }
                ],
                url: undefined,
                title: undefined,
            }
        ]
    });
});
