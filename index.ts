import type {
  CodemodeToolDetails,
  ExtensionAPI,
  ThemeColor,
  ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Container, Text, TruncatedText } from "@earendil-works/pi-tui";

type CallStatus = CodemodeToolDetails["calls"][number]["status"];
type Content = { type: string; text?: string }[];

const INTENT = /^[ \t]*\/\/[ \t]*@intent:[ \t]*(\S.*)$/m;
const GUIDELINE =
  "Start every codemode script with `// @intent: <short label>` describing why it runs, in the user's language. If the script has a `// @options:` line, keep that first and put the intent on the next line.";
const BLOCK_REASON = `Missing intent. ${GUIDELINE}`;
const MARKS: [CallStatus, string, ThemeColor][] = [
  ["error", "✗", "error"],
  ["cancelled", "⊘", "muted"],
  ["running", "…", "warning"],
];

function errorLine(content: Content): string {
  const texts = content.flatMap((item) => (item.type === "text" && item.text ? [item.text] : []));
  if (texts.some((text) => text.includes(BLOCK_REASON))) return "blocked: missing // @intent";
  const scriptError = texts.find((text) => text.startsWith("Script error:"));
  const source = scriptError ? scriptError.slice("Script error:".length) : texts.join("\n");
  return (
    source
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "error"
  );
}

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => {
    const guidelines = event.systemPromptOptions.toolGuidelines;
    if (guidelines.codemode) guidelines.codemode = [...guidelines.codemode, GUIDELINE];
  });

  pi.on("tool_call", (event) => {
    if (event.toolName !== "codemode") return;
    const code = event.input.code;
    if (typeof code === "string" && INTENT.test(code)) return;
    return { block: true, reason: BLOCK_REASON };
  });

  pi.registerToolRenderer((name, next) => {
    const base = next();
    if (name !== "codemode" || !base?.renderCall || !base.renderResult) return base;
    const { renderCall, renderResult } = base;

    const renderers: ToolRenderers = {
      ...base,
      renderCall(args, theme, context) {
        if (context.expanded)
          return renderCall(args, theme, { ...context, lastComponent: undefined });
        const code: unknown = (args as { code?: unknown } | undefined)?.code;
        const intent = typeof code === "string" ? (code.match(INTENT)?.[1]?.trim() ?? "") : "";
        return new Text(
          `${theme.fg("toolTitle", theme.bold("codemode"))} ${theme.fg("accent", intent)}`,
          0,
          0,
        );
      },
      renderResult(result, options, theme, context) {
        if (options.expanded)
          return renderResult(result, options, theme, { ...context, lastComponent: undefined });
        const groups = new Map<string, CallStatus[]>();
        for (const call of (result.details as CodemodeToolDetails | undefined)?.calls ?? []) {
          groups.set(call.name, [...(groups.get(call.name) ?? []), call.status]);
        }
        const lines = [...groups].map(([tool, statuses]) => {
          let line = `${theme.fg("toolTitle", tool)} ${theme.fg("dim", `× ${statuses.length}`)}`;
          for (const [status, mark, color] of MARKS) {
            const n = statuses.filter((s) => s === status).length;
            if (n) line += ` ${theme.fg(color, `${mark} ${n}`)}`;
          }
          return line;
        });
        const component = new Container();
        if (lines.length) component.addChild(new Text(lines.join("\n"), 0, 0));
        if (context.isError)
          component.addChild(
            new TruncatedText(theme.fg("error", `✗ ${errorLine(result.content)}`), 0, 0),
          );
        return component;
      },
    };
    return renderers;
  });
}
