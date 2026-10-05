import type {
  CodemodeToolDetails,
  ExtensionAPI,
  ThemeColor,
  ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text, TruncatedText } from "@earendil-works/pi-tui";

type CallStatus = CodemodeToolDetails["calls"][number]["status"];
type Content = { type: string; text?: string }[];

const INTENT = /^[ \t]*\/\/[ \t]*@intent:[ \t]*(\S.*)$/m;
const GUIDELINE =
  "Start every codemode script with `// @intent: <short label>` describing why it runs, in the user's language. If the script has a `// @options:` line, keep that first and put the intent on the next line.";
const BLOCK_REASON = `Missing \`// @intent:\` line.\n${GUIDELINE}`;
const MARKS: [CallStatus, string, ThemeColor][] = [
  ["error", "✗", "error"],
  ["cancelled", "⊘", "muted"],
  ["running", "…", "warning"],
];

function errorLine(content: Content): string {
  const text = content.map((item) => item.text ?? "").join("\n");
  return (text.match(/^Script error:\n(.+)/m)?.[1] ?? text.split("\n")[0]).trim();
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
    if (name !== "codemode" || !base?.renderCall) return base;
    const { renderCall } = base;

    const renderers: ToolRenderers = {
      ...base,
      renderCall(args, theme, context) {
        if (context.expanded)
          return renderCall(args, theme, { ...context, lastComponent: undefined });
        const code: unknown = (args as { code?: unknown } | undefined)?.code;
        const intent = typeof code === "string" ? (code.match(INTENT)?.[1]?.trim() ?? "") : "";
        return new Text(
          intent ? theme.fg("accent", intent) : theme.fg("toolTitle", theme.bold("codemode")),
          0,
          0,
        );
      },
      renderResult(result, options, theme, context) {
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
        if (options.expanded && (lines.length || context.isError))
          component.addChild(new Spacer(1));
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
