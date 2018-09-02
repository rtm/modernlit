import * as path from "path";
import * as fs from "fs";
import DataUri from "datauri";
import deepmerge from "deepmerge";
import jsYaml from "js-yaml";
import rc from "rc";
import minimist from "minimist";
import chokidar from "chokidar";
import * as sourcemap from "source-map";
import mkdirp from "mkdirp";

import glob from "glob";

import * as prettier from "prettier";
import jsBeautify from "js-beautify";

import unified from "unified";
import find from "unist-util-find";
import visit from "unist-util-visit";
import toString from "mdast-util-to-string";
import select from "unist-util-select";

// Imports for rehype (HAST, representing HTML)
import addClasses from "rehype-add-classes";
import doc from "rehype-document";
import raw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import wrap from "rehype-wrap";

// Imports for remark (MDAST, repersenting Markdwon)
import remark from "remark";
import collapse from "remark-collapse";
import emoji from "remark-emoji";
import frontmatter from "remark-frontmatter";
import highlight from "remark-highlight.js";
import remarkHtml from "remark-html";
import parse from "remark-parse";
import remarkRehype from "remark-rehype";
import shortcodes from "remark-shortcodes";
import textr from "remark-textr";
import mermaid from "remark-mermaid";

// Imports for vfiles (virtual files, with message history)
import VFile from "vfile";
import toVfile from "to-vfile";
import reporter from "vfile-reporter";

import typographicBase from "typographic-base";
import typographicGuillemets from "typographic-guillemets";

const {promisify} = require("util");
const exists = promisify(fs.exists);
const mkdir = promisify(fs.mkdir);
const globP = promisify(glob);
const writeFile = promisify(fs.writeFile);
const mkdirpP = promisify(mkdirp);

// NEWLINES
const platformNewline = require("os").EOL as string;

export type Newline = "crlf" | "lf" | "auto";

const newlines = {
  crlf: "\r\n",
  lf: "\n",
  auto: platformNewline,
};

export const eol = (newline: Newline) => newlines[newline];

export const newlineRe = /\r\n?|\n/;

export interface MermaidConfig {
  theme: "default" | "forest" | "dark" | "neutral";
  backgroundColor: string;
}

// In modernlit, transclusions are embedded in native commetns.
// We want to detect if a particular line--in any language (!)--is a transclusion.
// It has to be a comment, containing `<<>>`, with what's inside being captured.
// By definition, this must all be on one line.
//
// Isn't there some better way to do this?
function makeTransclusionChecker(lang: string) {
  const styles = {
    html: /<!--\s*<<(.*)>>.*-->/,
    doubleSlash: /\s*\/\/.*<<(.*)>>/,
    slashStar: /\/\*.*<<(.*)>>.*\*\//,
    hash: /\s*#.*<<(.*)>>/,
    haskell: /\{-.*<<(.*)>>.*-\}/,
  };

  const languages = {
    c: ["doubleSlash", "slashStar"],
    cpp: ["doubleSlash", "slashStar"],
    css: ["slashStar"],
    cs: ["doubleSlash", "slashStar"],
    hs: ["haskell"],
    html: ["html"],
    java: ["doubleslash"],
    js: ["doubleSlash", "slashStar"],
    py: ["hash"],
    sass: ["doubleSlash", "slashStar"],
    scss: ["doubleSlash", "slashStar"],
    sh: ["hash"],
    ts: ["doubleSlash", "slashStar"],
    xhtml: ["html"],
  };

  const styleList = languages[lang] || [];

  return (line: string) => {
    for (const style of styleList) {
      const match = line.match(styles[style]);

      if (match) return match;
    }
  };
}

export interface Config {
  help: boolean;
  indent: number;
  indentInnerHtml: boolean;
  lineLength: number;
  lint: boolean;
  mermaid: Partial<MermaidConfig>;
  newline: Newline;
  only: string;
  outDir: string;
  prettier: prettier.Options;
  quiet: boolean;
  recurse: boolean;
  sourcemap: boolean;
  mapRoot: string;
  stripComment: boolean;
  style: string;
  theme: string;
  title: string;
  verbose: boolean;
  watch: boolean;
  wrapAttributes: "auto" | "force";
}

// Utility to create slugs from fragment titles, which we will use as IDs.
// `avoidDuplicates` is not implemented!
function slugify(string: string, avoidDuplicates: string[] = [], maxLength = 32): string {
  return (
    string
      .toLowerCase()

      // Replace spaces with dashes.
      .replace(/\s+/g, "-")

      // Kill non-alphanumerics.
      .replace(/[^\w-]+/g, "")

      // Replace multiple hyphens.
      .replace(/-{2,}/g, "-")

      // Enforce length.
      .slice(0, maxLength)

      // Remove leading and trailing hyphens.
      .replace(/^-|-$/g, "")
  );
}

// A remark plugin to allow custom block-level literate programming fragments
//  of the form `<<fragment name>>=` (with an optional `+`).
//
//  Note that this plugin does not apply any transformations, but simply
//  parses the syntax and adds the relevant data to the AST.
//
//  To apply transformations from the fragments to HTML or other
//  formats, please see the example in the README.
//
//  <<frament-title>>=
//  <<fragment-title>>+=
//
//  {
//  type: 'MlFragment',
//  value: 'fragment-title",
//  \      increment: boolean
//  }
//
//  With thanks to official remark plugins:
//  https://github.com/wooorm/remark-breaks/blob/master/index.js
//  https://github.com/wooorm/remark-gemoji/blob/master/index.js
//  https://github.com/djm/remark-shortcodes
//
// NOT CURRENTLY USED.

function mlfragments(this: any) {
  if (isRemarkParser(this.Parser)) {
    const parser = this.Parser.prototype;
    parser.blockTokenizers.mlfragment = tokenizer;
    parser.blockMethods.splice(parser.blockMethods.indexOf("html"), 0, "mlfragment");
  }
  if (isRemarkCompiler(this.Compiler)) {
    const compiler = this.Compiler.prototype;
    compiler.visitors.mlfragment = compiler;
  }

  function locator(value, fromIndex) {
    return value.indexOf("<<", fromIndex);
  }

  function tokenizer(eat: (value: string) => Function, value: string, silent?: boolean) {
    var innerFragment;
    var parsedFragment;
    var endPosition;
    var endBlockPosition;

    const [match, name, increment, index] = (/^<<(.*?)>>(\+?)=/.exec(value) || []) as any[];
    if (!match) return;

    /* Exit with true in silent mode after successful parse - never used (yet) */
    if (silent) return true;

    const eater = eat(match);
    return eater({type: "mlfragment", value: name, increment: !!increment});
  }
  (tokenizer as any).locator = locator;

  function compiler(node) {
    return `<<${node.value}>>${node.increment ? "+" : ""}`;
  }
}

function isRemarkParser(parser) {
  return Boolean(
    parser &&
      parser.prototype &&
      parser.prototype.inlineTokenizers &&
      parser.prototype.inlineTokenizers.break &&
      parser.prototype.inlineTokenizers.break.locator
  );
}

function isRemarkCompiler(compiler) {
  return Boolean(compiler && compiler.prototype);
}
// Converr our own "weave" config into a configuration for beautify-js.
// Right now we are only handling indent and indent_inner_html.
function makeJsBeautifyOptions(config: Config) {
  const {
    indent: indent_size,
    indentInnerHtml: indent_inner_html,
    lineLength: wrap_line_length,
    wrapAttributes: wrap_attributes,
  } = config;

  return {indent_size, indent_inner_html, wrap_line_length, wrap_attributes};
}

// Convert our own "weave" config into a configuration for prettier.js.
function mapPrettierOptions(config: Config): Partial<prettier.Options> {
  // Create an object of prettier options based on whatever weave options are set.
  const result: prettier.Options = {};

  if ("lineLength" in config) {
    const lineLength = +config.lineLength;

    if (!isNaN(lineLength)) result.printWidth = lineLength;
  }

  if ("indent" in config) result.tabWidth = config.indent;

  return result;
}

async function getThemeCss(theme: string) {
  const themePath = path.join(__filename, "..", "themes", `${theme}.css`);
  const themeCss = await DataUri.promise(themePath);

  return themeCss;
}

// Turn the run-time JS support into a Data URL so it can be directly included in the HTML.
// This would not be necessary if `rehype-doc` supported inserting JS source in the HTML file.
async function getBrowserJs() {
  const jsPath = path.join(__filename, "..", "themes", "modernlit-browser.js");
  const datauri = await DataUri.promise(jsPath);

  return datauri;
}

// Group h2s and everything following them into a section.
function h2ToSection() {
  return ast => {
    const sections: any[] = [];
    let children = sections;

    for (const child of ast.children) {
      if (child.tagName && child.tagName === "h2")
        sections.push({type: "element", tagName: "section", children: (children = [])});
      children.push(child);
    }

    ast.children = sections;
  };
}

// Abstract away the notion of a "fragment heading".
function isFragmentHeading(node) {
  return node.type === "heading" && node.depth === 5;
}

interface Fragment {
  name: string;
  codes: any[];
  usedBy?: string[];
}

// Traverse the tree, finding fragment headings, and associate them with the following code.
// Currently, the logic is that code must follow immediately.
// Annotate each code block with an incremental flag, as well as a fragment index.
// Return an array of all the fragments, each pointing to one or more code blocks with the same name.
function findFragments() {
  return (ast, file) => {
    const fragments: Fragment[] = [];

    visit(ast, "heading", (node, index: number, parent) => {
      if (!isFragmentHeading(node)) return;

      const code = parent.children[index + 1];
      const name = toString(node);

      // The following node must be code; otherwise report and abort.
      if (!code || code.type !== "code")
        return file.message(
          `Fragment heading not followed by code (${name})`,
          node.position.start,
          "parse:weave"
        );

      // See if a fragment with this name has already been encountered.
      let fragmentIndex = fragments.findIndex(fragment => fragment.name === name);

      if (!node.data) node.data = {};
      if (!node.data.hProperties) node.data.hProperties = {};
      node.data.id = node.data.hProperties.id = slugify(name);

      // For new fragments, make a new entry in the fragments array.
      if (fragmentIndex === -1) fragmentIndex = fragments.push({name, codes: []}) - 1;
      else node.data.hProperties["data-increment"] = node.data.increment = true;

      // Record the code fragment in the array associatec with the fragment name.
      fragments[fragmentIndex].codes.push(code);
      node.data.hProperties["data-index"] = node.data.index = fragmentIndex + 1;
    });

    if (!ast.data) ast.data = {};
    ast.data.fragments = fragments;
  };
}

// Travers the MDAST for comments which could be references.
// We look for code nodes, under which the highlighting logic should have placed `hChildren` properties,
// which we can traverse to find comments, as identified by a potential HTML class of `hljs-comment`.
function codeComments() {
  return (ast, file: VFile) => {
    const fragments: Fragment[] = ast.data.fragments;

    visit(ast, "code", (mdastNode, index: number, parent) => {
      // Get the heading preceding this code block, from which we can derive its name.
      const heading = parent.children[index - 1];

      if (!heading) {
        console.log("heading does not precede code");
        return;
      }

      const containingFragmentName: string = toString(heading).trim();

      const hChildren = mdastNode.data && mdastNode.data.hChildren;

      if (!hChildren) return;

      for (const hChild of hChildren) {
        visit(hChild, "element", hastNode => {
          if (
            !hastNode.properties ||
            !hastNode.properties.className ||
            hastNode.properties.className.indexOf("hljs-comment") === -1
          )
            return;

          const [child] = hastNode.children || [undefined];

          if (!child || child.type !== "text")
            return (
              console.log("poblem", child) ||
              file.message(`Malformed reference`, mdastNode.position.start, "parse:weave")
            );

          if (!/<<.*>>/.test(child.value)) return;

          const name = (child.value = child.value.replace(/^.*<<|>>.*$/g, ""));
          const fragmentIndex = fragments.findIndex(fragment => fragment.name === name);

          if (!hastNode.properties) hastNode.properties = {};
          if (!hastNode.properties.className) hastNode.properties.className = [];

          hastNode.properties.className.push("ml-comment-link");

          if (fragmentIndex === -1) {
            hastNode.properties["data-index"] = "MISSING";
            return file.message(
              `Reference to unknown fragment '${name}'`,
              mdastNode.position.start,
              "parse:weave"
            );
          }

          hastNode.properties["data-index"] = fragmentIndex + 1;

          const fragment = fragments[fragmentIndex];
          if (!fragment.usedBy) fragment.usedBy = [];
          fragment.usedBy.push(containingFragmentName);

          hastNode.children[0] = {
            type: "element",
            tagName: "a",
            properties: {href: "#" + slugify(name)},
            children: [child],
          };
        });
      }
    });
  };
}

// Create a mermaid representation of the graph structure of the "web".
function makeGraph(fragments: Fragment[]) {
  let s: string = "graph LR;\n";

  for (let i = 0; i < fragments.length; i++) {
    const {name, usedBy = []} = fragments[i];

    s += `N${i}[${name}];\n`;
    s += `click N${i} "#${slugify(name)}";\n`;

    for (const user of usedBy) {
      const usedByIndex = fragments.findIndex(fragment => fragment.name === user);
      s += `N${usedByIndex} --> N${i};\n`;
      //      s += `N${usedByIndex}-- uses --N${i};\n`;
    }
  }

  return s;
}

// Given a list of fragment information, which includes usedBy for each fragment, Add relevant notes to the tree.
// The plan is to find the fragment titles, then insert the usedBy notation after the code.
function insertUsedBy() {
  return (ast, file: VFile) => {
    const fragments: Fragment[] = ast.data.fragments;

    visit(ast, "heading", (node, index: number, parent) => {
      if (!isFragmentHeading(node)) return;

      const code = parent.children[index + 1];
      const name = toString(node);

      if (!code || code.type !== "code") return;

      // See if a fragment with this name has already been encountered.
      const fragment = fragments.find(fragment => fragment.name === name);
      if (!fragment) throw new Error("fragment not registere in fragment table");
      if (!fragment.usedBy || !fragment.usedBy.length) return;

      let usedBys: any[] = [];
      let first = true;

      for (const usedBy of fragment.usedBy) {
        if (!first) usedBys.push({type: "text", value: "; "});
        first = false;
        usedBys.push({
          type: "link",
          url: "#" + slugify(usedBy),
          data: {
            hProperties: {
              className: ["ml-used-by-link"],
              "data-index": fragments.findIndex(fragment => fragment.name === usedBy) + 1,
            },
          },
          children: [
            {
              type: "emphasis",
              children: [
                {
                  type: "text",
                  value: usedBy,
                },
              ],
            },
          ],
        });
      }

      const usedByNode = {
        type: "paragraph",
        children: [{type: "text", value: "Used in "}, ...usedBys, {type: "text", value: "."}],
        data: {hProperties: {className: ["ml-used-by"]}},
      };

      parent.children.splice(index + 2, 0, usedByNode);
    });
  };
}

// Handle the shortcodes used to isnert a graph, or a list of fragments (GRAPH and TOF).
// Right now there are just those two shortcodes.
// This dependss on the remark-mermaid plugin running afterwards.
function handleShortcodes() {
  return (ast, file) => {
    const fragments: Fragment[] = ast.data.fragments;

    visit(ast, "shortcode", (node, index: number, parent) => {
      switch (node.identifier.toLowerCase()) {
        case "lof":
          const indices = fragments.map((_, i) => i);

          parent.children[index] = {
            type: "list",
            children: indices
              .sort((i1, i2) =>
                fragments[i1].name.toLowerCase().localeCompare(fragments[i2].name.toLowerCase())
              )
              .map(index => ({
                type: "listitem",
                children: [
                  {
                    type: "link",
                    url: "#" + slugify(fragments[index].name),
                    data: {hProperties: {className: ["ml-lof-link"], "data-index": index + 1}},
                    children: [{type: "text", value: fragments[index].name}],
                  },
                ],
              })),
          };
          break;

        case "graph":
          parent.children[index] = {
            type: "code",
            value: makeGraph(fragments),
            lang: "mermaid",
          };
          break;

        default:
          file.warning(
            `Unknown shortcode [[${node.identifier}]]`,
            node.position.start,
            "shortcuts:weave"
          );
      }
    });
  };
}

function makePrettier(this: any) {
  const config: Config = this.data("settings");

  return async (tree, file) => {
    const prettierConfig = await prettier.resolveConfig(file.path);

    visit(tree, "code", node => {
      const {lang, value} = node;
      const filepath = `foo.${lang}`;

      if (lang === "html" || lang === "mermaid") return;

      try {
        // Combine prettier options from .prettierrc etc., and our options.
        const options = {filepath, ...prettierConfig, ...config.prettier};

        const result = prettier.format(value, options);

        if (result) node.value = result;
        else
          file.message(
            `Formatting failed for ${lang}`,
            node.position.start,
            "format-code-block:weave"
          );
      } catch (e) {
        file.message(
          `No parser available for ${lang}`,
          node.position.start,
          "format-code-block:weave"
        );
        console.error("Prettier error was", e);
      }
    });
  };
}

function beautifyHtml() {
  return tree =>
    visit(
      tree,
      "code",
      node =>
        node.langCode === "html" &&
        (node.value = jsBeautify.html(node.value, makeJsBeautifyOptions(tree.dadta.config)))
    );
}

// Each theme can be associated with a set of plugins.
// Currently, we only have the Tufte theme.
const themePlugins = {
  tufte: [h2ToSection, [addClasses, {pre: "code"}], [wrap, {wrapper: "article"}]],
};

////////////////////////////////////////////////////////////////
// PROCESS FILE

// We are now ready to weave and tangle the modernlit document.
async function handleFile(file: VFile, initialConfig: Config) {
  // Handle prettier options, which may differ from file to file.
  let config = deepmerge(initialConfig, {});

  // Do things which are relevant whether weaving, tangling, or both.
  let processor = unified()
    .use({settings: config})
    .use(parse)
    .use(yaml)
    .use(findFragments);

  //  if (!config.only || config.only === "tangle") processor = processor.use(tangle);
  const weaving = !config.only || config.only === "weave";
  const tangling = !config.only || config.only === "tangle";

  if (tangling) processor = processor.use(await tangle());
  if (weaving) processor = processor.use(await weave());

  const result = await processor.process(file);
  if (weaving) await writeHtml(result);

  // Write out the woven HTML.
  // Create the directories if necessary.
  async function writeHtml(file: VFile) {
    // Compute directory and make sure it exists.
    const {outDir} = config;
    let dir = path.dirname(file.path);

    if (outDir) {
      dir = path.isAbsolute(outDir) ? outDir : path.join(dir, outDir);
      if (!(await exists(dir))) await mkdirpP(dir);
    }

    // Compute path and write out file.
    const newPath =
      path.join(dir, path.basename(file.path)).replace(/\.lit\.md$/, "") + ".lit.html";

    file.info(`Created ${newPath}`, null, "write-file:weave");
    toVfile.writeSync({path: newPath, contents: String(file)});
  }

  async function weave() {
    return [
      makePrettier,
      beautifyHtml,
      highlight,
      [textr, {plugins: [typographicBase, typographicGuillemets]}],
      shortcodes,
      codeComments,
      insertUsedBy,
      handleShortcodes,
      [mermaid, {simple: true}],
      [remarkRehype, {allowDangerousHTML: true}],
      console.log(config.theme, themePlugins[config.theme]) || themePlugins[config.theme],
      rehypeStringify,
      raw,
      [
        doc,
        {
          css: [
            `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/9.12.0/styles/${
              config.style
            }.min.css`,
            // This is a monospaced font for code, with ligatures which you will either love or hate.
            "https://cdn.rawgit.com/tonsky/FiraCode/1.205/distr/fira_code.css",
            // This font looks interesting.
            "https://fonts.googleapis.com/css?family=Anonymous+Pro:400,400i,700,700i",
            // This is the CSS for the Tufte style.
            // See https://edwardtufte.github.io/tufte-css/.
            // It also uses an elegant serifed font called et-book.
            // See https://github.com/edwardtufte/et-book/
            "https://cdnjs.cloudflare.com/ajax/libs/tufte-css/1.4/tufte.css",
            await getThemeCss(config.theme),
          ],
          js: [
            // Mermaid
            "https://cdnjs.cloudflare.com/ajax/libs/mermaid/7.1.2/mermaid.min.js",
            new DataUri().format(
              ".js",
              `mermaid.initialize(${JSON.stringify({
                startOnLoad: true,
                loadOnStart: true,
                mermaid: {startOnLoad: true, loadOnStart: true},
                ...config.mermaid,
              })})`
            ).content,
            await getBrowserJs(),
          ],
          title: config.title,
        },
      ],
    ];
  }
}

// YAML
// Options are provided by YAML block at the top of the file.
// They are found in a `yaml` child of the root of the MDAST.
// Read them in and update the tree's configuration.
const yaml = [frontmatter, parseYaml];

function parseYaml(this: {data: (key: string, value?: any) => any}) {
  const config: Config = this.data("settings");

  return (tree, file: VFile) => {
    const yaml = find(tree, {type: "yaml"});

    if (yaml) {
      const yamlData = jsYaml.safeLoad(yaml.value);
      if (config.verbose || yamlData.verbose)
        file.info("Processed front matter", yaml.position.start, ":parse");
      // So, where are we supposed to keep this?
      // Unified compalines that data cannot be called on a "frozen" processor.
    }
  };
}

function tangle() {
  return [writeSourceFiles];
}

// Write out tangled files, and sourcemaps.
function writeSourceFiles(this: any) {
  const {outDir, mapRoot, sourcemap: makeSourcemap, newline = "auto"}: Config = this.data(
    "settings"
  );
  const newlineChar = eol(newline);
  console.log({newlineChar});

  return async (ast, file) => {
    const fragments: Fragment[] = ast.data.fragments;
    console.assert(!!fragments, "MDAST must have fragments data");

    // Loop over all the fragments that we want to write out.
    const outputFragments = fragments.filter(({name}) => name.startsWith(">"));

    for (const fragment of outputFragments) {
      const filename = fragment.name.slice(1);
      const ext = filename.split(".").pop();
      const transclusionChecker = makeTransclusionChecker(ext as string);
      let outputLineCnt = 0;
      let recursionCount = 0;

      // Only certain types have source maps. HTML does not, for example.
      const hasSourcemap =
        makeSourcemap &&
        (ext === "css" || ext == "scss" || ext == "sass" || ext == "ts" || ext == "js");

      let dir = file.dirname;
      const sourcemapGenerator = new sourcemap.SourceMapGenerator({
        file: path.join(mapRoot || "", filename),
      });

      if (outDir) {
        dir = path.isAbsolute(outDir) ? outDir : path.join(dir, outDir);
        if (!(await exists(dir))) await mkdirpP(dir);
      }

      let s = "";
      addFragmentCodes(fragment);

      // Compute path and write out file.
      const newPath = path.join(dir, filename);
      const sourcemapPath = newPath + ".map";

      if (hasSourcemap) {
        file.info(`Created sourcemap ${sourcemapPath}`, null, "write-file:tangle");
        toVfile.writeSync({path: sourcemapPath, contents: sourcemapGenerator.toString()});
        s += `${newlineChar}/*${newlineChar}//# sourceMappingURL=${filename}.map${newlineChar}*/${newlineChar}`;
      }

      toVfile.writeSync({path: newPath, contents: s});
      file.info(`Created ${newPath}`, null, "write-file:tangle");

      // Add one block to the output.
      // Recursively add additional blocks as they are detected.
      function addFragmentCodes(fragment: Fragment) {
        let incr = 0;
        if (recursionCount++ > 1000) throw new Error("Tangling is in an infinite loop!");

        for (let {
          value,
          position: {
            start: {line, column},
          },
        } of fragment.codes || []) {
          for (const l of value.split(newlineRe)) {
            s += l + newlineChar;
            line++;

            sourcemapGenerator.addMapping({
              generated: {line: ++outputLineCnt, column: 0},
              source: file.basename,
              original: {line, column},
            });

            const match = transclusionChecker(l);

            if (match) {
              const name = match[1];
              const fragment = fragments.find(fragment => fragment.name === name);

              if (fragment) addFragmentCodes(fragment);
              else console.log("While tnagling, could not find fragment", name);
            }
          }
        }
      }
    }
  };
}

////////////////////////////////////////////////////////////////
// COMMAND LINE VERSIONS

// Linting. This is available by means of the `--lint` option.
const lintPlugins = [
  //  This doesn't work properly, probably because of the two dots.
  //  [require("remark-lint-file-extension"), "lit.md"],

  [require("remark-lint-maximum-line-length"), 100],
  //  require("remark-lint-no-consecutive-blank-lines"),
  [require("remark-lint-code-block-style"), "fenced"],
  [require("remark-lint-fenced-code-flag"), {allowEmpty: false}],
  [require("remark-lint-fenced-code-marker"), "`"],
];

// Weaving from command line.
async function modernlit() {
  // Default.
  const config = {
    indentInnerHtml: true,
    mermaid: {},
    style: "github",
    theme: "tufte",
    title: "modernlit",
    wrapAttributes: "auto",
  } as Config;

  const minimistConfig = {boolean: true};
  const options = minimist(process.argv.slice(2), minimistConfig) as any;
  const files = options._;

  rc("modernlit", config, options);
  const configs = config["configs"];

  const {help, recurse, quiet, lint, watch, verbose} = config;

  if (help) usage(), process.exit(1);
  if (!files || !files.length) console.log("No files specified."), process.exit(1);
  if (verbose && configs) console.log("Using config files", configs.join(", "));

  const globPatterns = files.map(file => `${file}/**/*.lit.md`);
  const globbedFiles = recurse ? await globP(globPatterns.join(" ")) : files;

  // Handle the specified files or directories right now, and log results if not quiet.
  const vfiles: VFile[] = [];
  for (const file of globbedFiles) vfiles.push(await handle(file));
  if (!quiet) console.error(reporter(vfiles));

  // Watch for changes if that was requested.
  if (watch)
    chokidar
      .watch(recurse ? globPatterns : files, {ignoreInitial: true})
      .on("all", async (event, path) => {
        if (event === "add" || event === "change") {
          const vfile = await handle(path);
          if (!quiet) console.error(reporter(vfile));
        }
      });

  // Handle s single file, either initially or when watch triggers.
  async function handle(path: string): Promise<VFile> {
    const vfile = toVfile.readSync({path});

    if (lint)
      await remark()
        .use({plugins: lintPlugins})
        .process(vfile);

    await handleFile(vfile, config);

    return vfile;
  }

  function usage() {
    console.log("Usage:");
    console.log();
    console.log("modernlit  [options] source-file ...");
    console.log();
    console.log("Options");
    console.log("  --help              Display this message");
    console.log("  --indent=           Width of indentation");
    console.log("  --lineLength=       Maximum line lnegth");
    console.log("  --lint              Check input files");
    console.log("  --mermaid.theme=    Theme for mermaid diagrams");
    console.log("  --outDir=           Location of output files");
    console.log("  --quiet             Suppress soutput");
    console.log("  --only=weave,tangle");
    console.log("  --prettier.semi            Insert semi-colons (true)");
    console.log("  --prettier.singleQuote     Use single quotes instead of double quotes (false)");
    console.log("  --prettier.trailingComma   Add trailing commas (none, es5, all)");
    console.log(
      "  --prettier.bracketSpacing  Print spaces between brackets in object literals (false)"
    );
    console.log("  --recurse           Process files in subdirectories");
    console.log("  --style=            Style for langauge highlighting");
    console.log("  --theme=            Theme (CSS) for weave output");
    console.log("  --title=            HTML title");
    console.log("  --watch             Watch for file changes and re-weave or re-tangle");
    console.log("  --verbose           Print additional information");
    console.log("  --wrapAttributes    Wrap HTML attributes (auto, force, etc.)");
  }
}

////////////////////////////////////////////////////////////////
// SOURCE MAPS

// Rewrite a sourcemap as generated by tsc to reflect the mapping from the modernlit input to TypeScript.
// That is the most common case, but actually this script doesn't care.
// For example, it could by applied to a sourcemap created by SCSS.
// Takes the "input" sourcemap on stdin, and outputs the remapped sourcemap on stdout.
// This routine is used by the `mlsourcemap` command installed into `node_mobulds/.bin`.
//
// Usage:
// ```
// cat foo.js.map | mlsourcem foo.ts.map > foo.js.map
// cat foo.css.map | mlsourcem foo.scss.map > foo.css.map
// ```

async function mlsourcemap() {
  // Get the input sourcemap (e.g., foo.js.map) from stdin.
  const inputSourcemapJson = fs.readFileSync("/dev/stdin", "utf-8");
  const inputSourcemap = JSON.parse(inputSourcemapJson);

  // The the modernlit sourcemap (e.g. foo.ts.map) from the first argument.
  const [, , mlSourcemapName] = process.argv;
  const mlSourcemapJson = fs.readFileSync(mlSourcemapName, "utf-8");
  const mlSourcemap = JSON.parse(mlSourcemapJson);

  // Create consumers for both sourcemaps.
  const inputConsumer = await new sourcemap.SourceMapConsumer(inputSourcemap);
  const mlConsumer = await new sourcemap.SourceMapConsumer(mlSourcemap);

  // Create a "generator" based on the input sourcemap consumer.
  const generator = sourcemap.SourceMapGenerator.fromSourceMap(inputConsumer);

  // "Apply" the modernlit sourcemap, and output it.
  generator.applySourceMap(mlConsumer);
  console.log(generator.toString());
}

export {modernlit, handleFile, mlsourcemap};
