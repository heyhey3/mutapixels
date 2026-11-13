"use client";

import { useState, type PointerEvent } from "react";
import { formatMUT, formatNear, formatTime } from "@/lib/api";
import type { HistoryEntry } from "@/lib/types";

type Point = {
  at: number;
  index: number;
  near: number;
  mut: number;
  kind: string;
  note: string;
};

const W = 380;
const H = 180;
const M = { l: 48, r: 16, t: 20, b: 28 };
const PLOT_W = W - M.l - M.r;
const PLOT_H = H - M.t - M.b;

function buildPoints(history: HistoryEntry[]): Point[] {
  const chronological = [...history].reverse();
  let near = 0;
  let mut = 0;
  return chronological.map((entry, index) => {
    const nearAmount = Number(entry.near_amount || "0") / 1e24;
    const mutAmount = Number(entry.mut_amount || "0") / 1e24;
    if (entry.kind === "withdraw") {
      near = Math.max(0, near - nearAmount);
      mut = Math.max(0, mut - mutAmount);
    } else if (entry.kind === "withdraw_failed") {
      near += nearAmount;
      mut += mutAmount;
    } else if (entry.kind === "transfer" || entry.kind === "transfer_reverted") {
      // Ownership moves; the token's balance does not.
    } else {
      near += nearAmount;
      mut += mutAmount;
    }
    return {
      at: entry.at,
      index,
      near,
      mut,
      kind: entry.kind,
      note: entry.note,
    };
  });
}

function StepChart({
  title,
  unit,
  values,
  points,
  series,
  format,
}: {
  title: string;
  unit: string;
  values: number[];
  points: Point[];
  series: "near" | "mut";
  format: (value: string, digits?: number) => string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const n = values.length;
  if (n === 0) return null;

  const maxValue = Math.max(...values, 0);
  const last = values[n - 1];
  // `values` are display units; the shared formatters expect yocto units.
  const fmt = (value: number) =>
    format(Math.round(value * 1e24).toString(), series === "near" ? 4 : 2);
  if (maxValue === 0) {
    return (
      <div className={`vault-chart ${series}`}>
        <div className="vault-chart-head">
          <span>{title}</span>
          <strong>0 {unit}</strong>
        </div>
        <div className="chart-empty vault-chart-empty">
          No {unit} activity yet.
        </div>
      </div>
    );
  }
  const yMax = maxValue * 1.2;
  const sx = (index: number) =>
    M.l + (n <= 1 ? PLOT_W / 2 : (index / (n - 1)) * PLOT_W);
  const sy = (value: number) => M.t + (1 - value / yMax) * PLOT_H;

  const lineStartX = n === 1 ? M.l : sx(0);
  const lineEndX = n === 1 ? W - M.r : sx(n - 1);
  let step =
    n === 1
      ? `M ${lineStartX.toFixed(2)} ${sy(values[0]).toFixed(2)} L ${lineEndX.toFixed(2)} ${sy(values[0]).toFixed(2)}`
      : `M ${sx(0).toFixed(2)} ${sy(values[0]).toFixed(2)}`;
  for (let index = 1; index < n; index += 1) {
    step += ` H ${sx(index).toFixed(2)} V ${sy(values[index]).toFixed(2)}`;
  }
  const area = `${step} L ${lineEndX.toFixed(2)} ${sy(0).toFixed(2)} L ${lineStartX.toFixed(
    2,
  )} ${sy(0).toFixed(2)} Z`;

  const label = fmt(last);
  const endAnchor = sx(n - 1) > W - M.r - 70 ? "end" : "start";
  const endLabelX = sx(n - 1) + (endAnchor === "end" ? -7 : 7);
  const endLabelY = Math.max(M.t + 10, sy(last) - 9);
  const hovered = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < n ? hoverIndex : null;

  function handleMove(event: PointerEvent<SVGRectElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const frac = (event.clientX - rect.left) / rect.width;
    const x = frac * W;
    const raw = ((x - M.l) / PLOT_W) * (n - 1);
    const index = Math.min(n - 1, Math.max(0, Math.round(raw)));
    setHoverIndex(index);
  }

  return (
    <div className={`vault-chart ${series}`}>
      <div className="vault-chart-head">
        <span>{title}</span>
        <strong>
          {label} {unit}
        </strong>
      </div>
      <div className="chart">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${title}: current balance ${label} ${unit} across ${n} events.`}
          onPointerLeave={() => setHoverIndex(null)}
        >
          <defs>
            <clipPath id={`vault-${series}-clip`}>
              <rect x={M.l} y={M.t} width={PLOT_W} height={PLOT_H} />
            </clipPath>
          </defs>
          <g className="chart-grid" aria-hidden="true">
            {[0, 0.5, 1].map((fraction) => (
              <line
                key={fraction}
                x1={M.l}
                x2={W - M.r}
                y1={sy(yMax * fraction)}
                y2={sy(yMax * fraction)}
              />
            ))}
          </g>
          <g clipPath={`url(#vault-${series}-clip)`}>
            <path d={area} className="chart-area" />
            <path d={step} className="chart-line" />
          </g>
          <g className="chart-axis" aria-hidden="true">
            {[0, 0.5, 1].map((fraction) => (
              <text
                key={fraction}
                x={M.l - 8}
                y={sy(yMax * fraction) + 4}
                textAnchor="end"
              >
                {fmt(yMax * fraction)}
              </text>
            ))}
            {n > 1 ? (
              <text x={sx(0)} y={H - 8} textAnchor="start">
                start
              </text>
            ) : null}
            <text x={sx(n - 1)} y={H - 8} textAnchor={n === 1 ? "middle" : "end"}>
              now
            </text>
          </g>

          <circle
            cx={sx(n - 1)}
            cy={sy(last)}
            r={4}
            className="chart-dot series-dot"
          />
          <text
            x={endLabelX}
            y={endLabelY}
            textAnchor={endAnchor}
            className="chart-point-label"
          >
            {label} {unit}
          </text>

          {hovered !== null ? (
            <g className="chart-hover" aria-hidden="true">
              <line
                x1={sx(hovered)}
                x2={sx(hovered)}
                y1={M.t}
                y2={M.t + PLOT_H}
              />
              <circle
                cx={sx(hovered)}
                cy={sy(values[hovered])}
                r={3.5}
              />
            </g>
          ) : null}

          <rect
            x={M.l}
            y={M.t}
            width={PLOT_W}
            height={PLOT_H}
            fill="transparent"
            onPointerMove={handleMove}
            onPointerDown={handleMove}
          />
        </svg>

        {hovered !== null ? (
          <div
            className="chart-tooltip"
            style={{
              left: `${Math.min(92, Math.max(8, (sx(hovered) / W) * 100))}%`,
              top: `${Math.min(82, Math.max(10, (sy(values[hovered]) / H) * 100))}%`,
            }}
          >
            <div className="chart-tooltip-title">
              {points[hovered].kind.replaceAll("_", " ")}
            </div>
            <div>
              <span>Time</span>
              <strong>{formatTime(points[hovered].at)}</strong>
            </div>
            <div>
              <span>{unit}</span>
              <strong>{fmt(values[hovered])}</strong>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function VaultCurve({ history }: { history: HistoryEntry[] }) {
  const points = buildPoints(history);
  if (points.length === 0) return null;

  const nearValues = points.map((point) => point.near);
  const mutValues = points.map((point) => point.mut);

  return (
    <div className="vault-curves">
      <div className="vault-curves-charts">
        <StepChart
          title="NEAR balance"
          unit="NEAR"
          values={nearValues}
          points={points}
          series="near"
          format={formatNear}
        />
        <StepChart
          title="$MUT balance"
          unit="MUT"
          values={mutValues}
          points={points}
          series="mut"
          format={formatMUT}
        />
      </div>

      <details className="chart-table">
        <summary>Data table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">Time</th>
              <th scope="col">NEAR balance</th>
              <th scope="col">MUT balance</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={`${point.index}-${point.kind}`}>
                <td>{point.kind.replaceAll("_", " ")}</td>
                <td>{formatTime(point.at)}</td>
                <td>{formatNear(Math.round(point.near * 1e24).toString(), 4)}</td>
                <td>{formatMUT(Math.round(point.mut * 1e24).toString(), 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
