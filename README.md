# ModernLit: a literate programming tool for the web

Modernlit is a tool which brings literate programming to the web.
[Literate programming](https://en.wikipedia.org/wiki/Literate_programming) is a programming paradigm
originated by the legendary Donald Knuth, in which a program is expressed as an explanation of the program logic in English,
interspersed with snippets of source code, from which both compilable source code and human documentation can be generated.

We will paraphrase the iniitial paragraph of Knuth's seminal work on the system he called WEB,
and the paper on its successor CWEB:

> The philosophy behind `modernlit` is that programmers who want to provide the best possible documentation for
their programs need two things simultaneously: a language like Markdown/HTML for formatting, and a language like JavaScript
(or other modern programming language)
for programming. Neither type of language can provide the best documentation by itself. But when both
are appropriately combined, we obtain a system that is much more useful than either language separately.

We have followed Knuth's original vision to the best of our ability,
given the evolution of the computing world over the last three decades,
and our decision to base the system on the widely-used Markdown syntax.
For insstance, code included in a modernlit source file is given as a Markdown "fenced code block".
We have chosen not to extend Markdown in any way.
This means that all modernlit files can be edited, viewed and processed by standard Markdown tools.

Like WEB and CWEB, the system provides two basic functions.
Weaving means to create documentation, and tangling means to create compilable/exectuable sources.
The `modernlit` executable does both by default.
You control which it does with options such as `--only=weave` or `--only=tange`.

## Quick start

Here is a [sample](sample/sample.lit.md) of a simple HTML/JS/CSS Hello World program.
The filetype we use is `.lit.md`.
The `.md` suffix allows us to use Markdown tools as we choose.

To create the files for the resulting app, you tangle it,
and to create the document in HTML form, you weave it,
both of which can be done with:

    $ modernlit sample.lit.md

This will create `index.html`, `index.js`, `index.css`, and `sample.lit.html`.
To run the app, you can then simply open `index.html` in a web browser.
To view the document, simply view `sample.lit.html` in your browser.

## Using and running

To start using modernlit, download the app:

    $ npm install --global @rtm/modernlit

This will result in the executable `modernlit` on your path,
which you can use to tangle and weave.

### Weaving

"Weaving" refers to creating human-readable documentation.
Currently only HTML is supported.
The generated HTML has many useful interactive features, such as jumping to a macro expansion,
and folding code blocks.
provid## Syntax

### Authoring

`modernlit` hews closely to the notions and syntax of literate programming as suggested by Knuth,
and found in his WEB and CWEB implementations,
as well as its spriritual successor `noweb`.
Where we depart is, first, using Markdown as the basic formatting language.
This decision also led us to use three backticks as the "code fence" which starts and ends code blocks,
as in GitHub-flavored Markdown.
Whereas Knuth used the `<<>>` syntax to introduce code blocks, and `@` to mark their end,
we use the fifth-level heading to introduce code fragments:

```markdown
##### Read in inputs
```

### Handling multiple output files

Since web programming typically involves multiple files, such as HTML, CSS, and JS,
we have extended the literate programming paradigm to allow one source file to generate multiple outputs,
by writing the name of the output file after the three backticks starting the code block:

```markdown
##### >foo.html
```

The language of each block is given following the initial fence of three backticks.
Examples include `js`, `html`, `ts`, etc.

### Defining code fragments

A key aspect of Knuth's vision was the notion of "code fragments".
Code fragments provide a way to break up code in a way more suited to human consumption,
both in terms of granularity and order.

In Knuth's original implementation, code fragments were defined using a `<<macro-name>>=` syntax,
and then referenced using a `<<macro-name>>` syntax.
In modernlit, we follow this basic syntax, but for compatibility with various language tool chains,
we embed such macro references in the comment syntax of the underlying language, so for JS it would be

    ```js
    // <<Initialize queue>>

As in Knuth's original implementation, fragments can be augmented by simply writing another code block with the same macro name.

### Specialized features

We have introduced a small new feature in the Markdown used by `modernlit`: "shortcodes" in double square brakcets.
The two shortcodes current available are

* `[[GRAPH]]`, which inserts a graph of the program structure
* `[[LOF]]`, which inserts a sorted, navigatable list of named porgram parts (the "F" meaning "fragment")

## CLI

The `modernlit` command is used for "weaving" (creating documentation) and "tangling" (creating compilable/executable files).

    modernlit input-file...

To display options, use the `--help` flag. To weave and tangle all the files in a directory,
use the `--recurse` option.

Note that it is your responsibility to add additional watch or live reload mechanisms to handle regenerated (woven) files.

### Options

Options may be given on the command line,
or in JSON format in a file called `.modernlitrc` in an appropriate place.
Options may also be put in individual files in the form of YAML "frontmatter" at the top.

```
---
title: My first app
---
```

## Editing environments

Unfortunately, editing `.lit.md` files in a text editor, even one that knows Markdwon,
is going to not provide us with any of the language-related tooling we have come to know and love,
including colorization, auto-complete, and error detection. That is a heavy price to pay.

The modernlit environment plans to provide a set of features to mitigate this problem.
The primary such feature will be a VSCode plugin. Stay tuned.

## Other notes

### Sourcemaps

modernlit is sourcemap-aware.
Sourcemaps are created based on the `--sourceMap` options.
They will be named something like `foo.ts.map`, of `foo.css.map`.
To modify the sourcemaps created by `tsc` or `sass`, add a command such as the following to your build pipeline:

    cat foo.js.map | mlsourcemap foo.ts.map > foo.js.map
    cat foo.css.map | mlsourcemap foo.scss.map > foo.css.map

This means that when you are debugging your code, you will see the line as found in the original `.lit.md` file.
