import {
  type CodemodeToolDetails,
  type ExtensionAPI,
  type ThemeColor,
  type ToolRenderers,
  isToolCallEventType,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text, TruncatedText } from "@earendil-works/pi-tui";

type CallStatus = CodemodeToolDetails["calls"][number]["status"];
type Content = { type: string; text?: string }[];

const INTENT = /^[ \t]*\/\/[ \t]*@intent:[ \t]*(\S.*)$/m;
const OPTIONS = /^[ \t]*\/\/ @options:[^\r\n]*/m;
const GUIDELINE =
  "Start every codemode script with `// @intent: <short label>` describing why it runs, in the user's language.";
const BLOCK_REASON = `Missing \`// @intent:\` line.\n${GUIDELINE}`;
const BASH_TIMEOUT = 60;
const BASH_GUIDELINE = `bash commands time out after ${BASH_TIMEOUT} seconds unless \`timeout\` is set. Do not run find, rg, or grep on \`/\` or \`~\` without a depth limit.`;
const MARKS: [CallStatus, string, ThemeColor][] = [
  ["ok", "", "dim"],
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
    const options = event.systemPromptOptions;
    const guidelines = options.toolGuidelines;
    if (guidelines.codemode) guidelines.codemode = [...guidelines.codemode, GUIDELINE];
    options.promptGuidelines = [...options.promptGuidelines, BASH_GUIDELINE];
  });

  pi.on("tool_call", (event) => {
    if (isToolCallEventType("bash", event)) {
      event.input.timeout ??= BASH_TIMEOUT;
      return;
    }
    if (event.toolName !== "codemode") return;
    const code = event.input.code;
    if (typeof code !== "string" || !INTENT.test(code))
      return { block: true, reason: BLOCK_REASON };
    // pi core requires `// @options:` on line 1; move it there if the intent came first.
    const m = code.match(OPTIONS);
    if (m?.index) {
      const rest = code.slice(m.index + m[0].length).replace(/^\r?\n/, "");
      event.input.code = `${m[0].trimStart()}\n${code.slice(0, m.index)}${rest}`;
    }
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
          let line = theme.fg("toolTitle", tool);
          for (const [status, mark, color] of MARKS) {
            const n = statuses.filter((s) => s === status).length;
            const label = statuses.length > 1 ? `${mark}${n}` : mark;
            if (n && label) line += ` ${theme.fg(color, label)}`;
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
