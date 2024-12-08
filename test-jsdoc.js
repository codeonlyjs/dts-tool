import { strict as assert } from "node:assert";
import { test } from "node:test";
import { 
parseUnwrapped, unwrap, 
tokenizeBraces, tokenizer, 
stripComments, parseJsDocComment,
parseNameSpecifier
} from "./jsdoc.js";


test("unwrap", () => {

    let r = unwrap(`    /** this is text
     * so is this
     * and this
     */   `);

    assert.equal(r, `this is text
so is this
and this`);
})

test("skip inline", () => {

    let r = parseUnwrapped(`this is an {@link inline line}`);
    assert.equal(r[0].name, "description");
    assert.equal(r[0].text, `this is an {@link inline line}`);

});

test("block", () => {

    let r = parseUnwrapped(`this is the description

@block This is a block
and so is this
@block Another block
`);

    assert.equal(r[0].name, "description");
    assert.equal(r[0].text, `this is the description\n`);
    assert.equal(r[1].name, "block");
    assert.equal(r[1].text, `This is a block\nand so is this`);
    assert.equal(r[2].name, "block");
    assert.equal(r[2].text, `Another block\n`);
});


test("tokenize braces (none)", () => {

    let b = tokenizeBraces("Hello World");

    assert.deepEqual(b, [
        { text: "Hello World" },
    ]);

});

test("tokenize braces (simple)", () => {

    let b = tokenizeBraces("Hello {there} World");

    assert.deepEqual(b, [
        { text: "Hello " },
        { braced: "there" },
        { text: " World" },
    ]);

});

test("tokenize braces (nested)", () => {

    let b = tokenizeBraces("Hello {{there}} World");

    assert.deepEqual(b, [
        { text: "Hello " },
        { braced: "{there}" },
        { text: " World" },
    ]);

});

test("tokenize braces (escaped)", () => {

    let b = tokenizeBraces("Hello {there\\}} World");

    assert.deepEqual(b, [
        { text: "Hello " },
        { braced: "there\}" },
        { text: " World" },
    ]);

});

test("tokenize braces (quoted)", () => {

    let b = tokenizeBraces("Hello {'th{}ere'} World");

    assert.deepEqual(b, [
        { text: "Hello " },
        { braced: "'th{}ere'" },
        { text: " World" },
    ]);

});

test("tokenize braces (link)", () => {

    let b = tokenizeBraces("Hello {@link class.member | title} World");

    assert.deepEqual(b, [
        { text: "Hello " },
        { braced: "@link class.member | title" },
        { text: " World" },
    ]);

});

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

    let t = tokenizer("{{there\\}}}", 0);

    let str = t.readBraced();
    assert.equal(str.raw, "{{there\\}}}");
    assert.equal(str.value, "{there}}");
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
        kind: "param",
        type: "paramType",
        name: {
            optional: false,
            name: "paramName",
            specifier: "paramName",
        },
        text: `parameter description
param desc continued
`,
    });

    assert.deepEqual(sections[2], {
        kind: "returns",
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