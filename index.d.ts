import * as prettier from "prettier";
import VFile from "vfile";
export declare type Newline = "crlf" | "lf" | "auto";
export declare const eol: (newline: Newline) => string;
export declare const newlineRe: RegExp;
export interface MermaidConfig {
    theme: "default" | "forest" | "dark" | "neutral";
    backgroundColor: string;
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
declare function handleFile(file: VFile, initialConfig: Config): Promise<void>;
declare function modernlit(): Promise<void>;
declare function mlsourcemap(): Promise<void>;
export { modernlit, handleFile, mlsourcemap };
