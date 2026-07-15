import { Card } from "@/components/ui/Card";
export function GradingScalesPage() {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Grading scales</h1>
      <Card className="text-ink-faint">Define letter-grade bands (A/B/C…) mapped to score ranges per subject or class.</Card>
    </div>
  );
}
