import { GateAnalysis, GateResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CheckCircle, XCircle, AlertTriangle, Minus } from "lucide-react";

interface GatePipelineProps {
  analysis: GateAnalysis;
}

function GateIcon({ result }: { result: GateResult }) {
  switch (result) {
    case "PASS":
      return <CheckCircle className="h-5 w-5 text-emerald-400" />;
    case "BLOCKED":
      return <XCircle className="h-5 w-5 text-red-400" />;
    case "GRACE PERIOD":
      return <AlertTriangle className="h-5 w-5 text-amber-400" />;
    case "N/A":
    default:
      return <Minus className="h-5 w-5 text-muted-foreground" />;
  }
}

function GateStep({
  number,
  title,
  result,
  detail,
  isLast,
}: {
  number: number;
  title: string;
  result: GateResult;
  detail: string;
  isLast?: boolean;
}) {
  const borderColor =
    result === "PASS"
      ? "border-emerald-500/40"
      : result === "BLOCKED"
      ? "border-red-500/40"
      : result === "GRACE PERIOD"
      ? "border-amber-500/40"
      : "border-border";

  const bgColor =
    result === "PASS"
      ? "bg-emerald-500/5"
      : result === "BLOCKED"
      ? "bg-red-500/5"
      : result === "GRACE PERIOD"
      ? "bg-amber-500/5"
      : "bg-card";

  return (
    <div className="flex items-stretch gap-3">
      {/* Vertical connector */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-mono font-bold",
            borderColor,
            bgColor
          )}
        >
          {number}
        </div>
        {!isLast && (
          <div className={cn("w-0.5 flex-1 min-h-6", borderColor.replace("border-", "bg-"))} />
        )}
      </div>
      {/* Content */}
      <div className={cn("flex-1 border rounded-md p-3 mb-3", borderColor, bgColor)}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <div className="flex items-center gap-1.5">
            <GateIcon result={result} />
            <span
              className={cn(
                "text-xs font-mono font-semibold uppercase",
                result === "PASS"
                  ? "text-emerald-400"
                  : result === "BLOCKED"
                  ? "text-red-400"
                  : result === "GRACE PERIOD"
                  ? "text-amber-400"
                  : "text-muted-foreground"
              )}
            >
              {result}
            </span>
          </div>
        </div>
        <p className="text-xs font-mono text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

export function GatePipeline({ analysis }: GatePipelineProps) {
  const gates = [
    { number: 1, title: "Cross-Tier ROLI", result: analysis.gate1, detail: analysis.gate1Detail },
    { number: 2, title: "Absolute Profit Floor", result: analysis.gate2, detail: analysis.gate2Detail },
    { number: 3, title: "Trajectory (MoM Improvement)", result: analysis.gate3, detail: analysis.gate3Detail },
  ];

  if (analysis.gate4) {
    gates.push({
      number: 4,
      title: "Inbound Competency (T2→T1)",
      result: analysis.gate4,
      detail: analysis.gate4Detail ?? "",
    });
  }

  return (
    <div className="py-2">
      {gates.map((gate, i) => (
        <GateStep
          key={gate.number}
          {...gate}
          isLast={i === gates.length - 1}
        />
      ))}
      {/* Final verdict */}
      <div className="mt-2 flex items-center gap-2">
        <div
          className={cn(
            "px-3 py-1.5 rounded-sm border font-mono text-sm font-bold uppercase",
            analysis.finalResult === "CLEARED"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              : "bg-red-500/10 border-red-500/30 text-red-400"
          )}
        >
          {analysis.finalResult === "CLEARED" ? "DEMOTION CLEARED" : "DEMOTION BLOCKED"}
        </div>
      </div>
    </div>
  );
}
