"use client";

import { useId, useState, type PointerEvent } from "react";

type Props = {
  mutReserve: bigint;
  nearReserve: bigint;
  amountIn: bigint;
  amountOut: bigint;
  direction: "sell" | "buy";
  feeBps: number;
};

const W = 760;
const H = 380;
const M = { l: 62, r: 18, t: 26, b: 46 };
const PLOT_W = W - M.l - M.r;
const PLOT_H = H - M.t - M.b;
const YOCTO = 1e24;

function formatX(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toFixed(1);
}

function formatY(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  if (value >= 10) return value.toFixed(1);
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(4);
}

function formatSpot(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(6);
}

export function AmmCurve({
  mutReserve,
  nearReserve,
  amountIn,
  amountOut,
  direction,
  feeBps,
}: Props) {
  const uid = useId().replaceAll(":", "");
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    leftPct: number;
    topPct: number;
  } | null>(null);

  const x0 = Number(mutReserve) / YOCTO;
  const y0 = Number(nearReserve) / YOCTO;
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || x0 <= 0 || y0 <= 0) {
    return <div className="chart-empty">Pool reserves are not available.</div>;
  }

  const aIn = Number(amountIn) / YOCTO;
  const aOut = Number(amountOut) / YOCTO;
  const hasTrade = amountIn > 0n && aOut > 0 && Number.isFinite(aOut);
  const x1 = hasTrade
    ? direction === "sell"
      ? x0 + aIn
      : Math.max(x0 * 0.02, x0 - aOut)
    : x0;
  const y1 = hasTrade
    ? direction === "sell"
      ? Math.max(y0 * 0.02, y0 - aOut)
      : y0 + aIn
    : y0;

  const k = x0 * y0;
  // Keep a stable window around the current reserve so dragging the trade size
  // moves the gold marker, not the whole chart. Extreme amounts expand it.
  const baseMin = Math.max(x0 * 0.01, x0 * 0.45);
  const baseMax = x0 * 1.55;
  const xMin = Math.max(x0 * 0.01, Math.min(baseMin, x1 - x0 * 0.08));
  const xMax = Math.max(baseMax, x1 + x0 * 0.08);
  const yMax = Math.max(y0 * 1.7, y1 * 1.15);

  const sx = (x: number) => M.l + ((x - xMin) / (xMax - xMin)) * PLOT_W;
  const sy = (y: number) => M.t + (1 - y / yMax) * PLOT_H;
  const curve = (x: number) => k / x;

  const curvePoints: string[] = [];
  const steps = 100;
  for (let i = 0; i <= steps; i += 1) {
    const x = xMin + ((xMax - xMin) * i) / steps;
    curvePoints.push(`${i === 0 ? "M" : "L"} ${sx(x).toFixed(2)} ${sy(curve(x)).toFixed(2)}`);
  }
  const curvePath = curvePoints.join(" ");
  const areaPath = `${curvePath} L ${sx(xMax).toFixed(2)} ${sy(0).toFixed(
    2,
  )} L ${sx(xMin).toFixed(2)} ${sy(0).toFixed(2)} Z`;

  const currentX = sx(x0);
  const currentY = sy(y0);
  const postX = sx(x1);
  const postY = sy(y1);
  const labelAnchor = postX > W - M.r - 90 ? "end" : "start";
  const labelOffset = labelAnchor === "end" ? -8 : 8;
  const currentAnchor = currentX > W - M.r - 44 ? "end" : "start";
  const currentOffset = currentAnchor === "end" ? -9 : 9;
  const closeTrade =
    hasTrade && Math.abs(postX - currentX) < 70 && Math.abs(postY - currentY) < 30;
  const postLabelY = closeTrade
    ? direction === "sell"
      ? postY + 18
      : postY - 18
    : postY - 9;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMax * f);
  const xTicks = [0, 0.5, 1].map((f) => xMin + (xMax - xMin) * f);

  const tableRows: Array<{ label: string; x: number; y: number; post?: boolean }> = [];
  const seen = new Set<string>();
  const addRow = (label: string, x: number, y: number, post = false) => {
    const key = `${x.toFixed(6)}:${y.toFixed(6)}:${post}`;
    if (seen.has(key)) return;
    seen.add(key);
    tableRows.push({ label, x, y, post });
  };
  addRow("Now", x0, y0);
  if (hasTrade) {
    addRow("After swap (fee-adjusted)", x1, y1, true);
    const mid = (x0 + x1) / 2;
    addRow("Midpoint on curve", mid, curve(mid));
  }
  addRow("Left sample", xMin, curve(xMin));
  addRow("Right sample", xMax, curve(xMax));

  function handlePointerMove(event: PointerEvent<SVGRectElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const frac = (event.clientX - rect.left) / rect.width;
    if (frac < 0 || frac > 1) {
      setHover(null);
      return;
    }
    const x = xMin + frac * (xMax - xMin);
    const y = curve(x);
    if (!Number.isFinite(y) || y <= 0 || y > yMax * 1.08) {
      setHover(null);
      return;
    }
    const leftPct = Math.min(92, Math.max(8, ((M.l + frac * PLOT_W) / W) * 100));
    const topPct = Math.min(82, Math.max(10, (sy(y) / H) * 100));
    setHover({ x, y, leftPct, topPct });
  }

  return (
    <div className="chart-wrap">
      <div className="chart-key">
        <span>
          <i className="key-line series" /> constant product · x·y = k
        </span>
        {hasTrade ? (
          <span>
            <i className="key-line trade" /> your swap
          </span>
        ) : null}
        <span className="chart-key-meta">fee {(feeBps / 100).toFixed(2)}%</span>
      </div>

      <div className="chart">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Constant-product curve for the MUT/wNEAR pool. Current reserves ${formatX(
            x0,
          )} MUT and ${formatY(y0)} wNEAR. ${
            hasTrade
              ? `A ${direction === "sell" ? "sell" : "buy"} of ${formatY(aIn)} ${
                  direction === "sell" ? "MUT" : "wNEAR"
                } moves the pool to ${formatX(x1)} MUT and ${formatY(y1)} wNEAR.`
              : "Adjust the trade amount to move along the curve."
          }`}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <clipPath id={`plot-${uid}`}>
              <rect x={M.l} y={M.t} width={PLOT_W} height={PLOT_H} />
            </clipPath>
          </defs>

          <g className="chart-grid" aria-hidden="true">
            {yTicks.map((tick) => (
              <line
                key={`y-${tick}`}
                x1={M.l}
                x2={W - M.r}
                y1={sy(tick)}
                y2={sy(tick)}
              />
            ))}
            {xTicks.map((tick) => (
              <line
                key={`x-${tick}`}
                x1={sx(tick)}
                x2={sx(tick)}
                y1={M.t}
                y2={M.t + PLOT_H}
              />
            ))}
          </g>

          <g clipPath={`url(#plot-${uid})`}>
            <path d={areaPath} className="chart-area" />
            <path d={curvePath} className="chart-line" />
            {hasTrade ? (
              <line
                x1={currentX}
                y1={currentY}
                x2={postX}
                y2={postY}
                className="chart-trade-line"
              />
            ) : null}
          </g>

          <g className="chart-axis" aria-hidden="true">
            {yTicks.map((tick) => (
              <text key={`yl-${tick}`} x={M.l - 10} y={sy(tick) + 4} textAnchor="end">
                {formatY(tick)}
              </text>
            ))}
            {xTicks.map((tick) => (
              <text
                key={`xl-${tick}`}
                x={sx(tick)}
                y={H - M.b + 20}
                textAnchor="middle"
              >
                {formatX(tick)}
              </text>
            ))}
            <text x={M.l + PLOT_W / 2} y={H - 6} textAnchor="middle" className="chart-axis-title">
              MUT reserve
            </text>
            <text x={M.l} y={14} textAnchor="start" className="chart-axis-title">
              wNEAR reserve
            </text>
          </g>

          <circle
            cx={currentX}
            cy={currentY}
            r={5}
            className="chart-dot series-dot"
          />
          <text
            x={currentX + currentOffset}
            y={currentY - 9}
            textAnchor={currentAnchor}
            className="chart-point-label"
          >
            now
          </text>

          {hasTrade ? (
            <>
              <circle cx={postX} cy={postY} r={5} className="chart-dot trade-dot" />
              <text
                x={postX + labelOffset}
                y={postLabelY}
                textAnchor={labelAnchor}
                className="chart-point-label"
              >
                after swap
              </text>
            </>
          ) : null}

          {hover ? (
            <g className="chart-hover" aria-hidden="true">
              <line
                x1={sx(hover.x)}
                x2={sx(hover.x)}
                y1={M.t}
                y2={M.t + PLOT_H}
              />
              <circle cx={sx(hover.x)} cy={sy(hover.y)} r={3.5} />
            </g>
          ) : null}

          <rect
            x={M.l}
            y={M.t}
            width={PLOT_W}
            height={PLOT_H}
            fill="transparent"
            onPointerMove={handlePointerMove}
          />
        </svg>

        {hover ? (
          <div
            className="chart-tooltip"
            style={{ left: `${hover.leftPct}%`, top: `${hover.topPct}%` }}
          >
            <div className="chart-tooltip-title">on the curve</div>
            <div>
              <span>MUT reserve</span>
              <strong>{formatX(hover.x)}</strong>
            </div>
            <div>
              <span>wNEAR reserve</span>
              <strong>{formatY(hover.y)}</strong>
            </div>
            <div>
              <span>Spot</span>
              <strong>{formatSpot(hover.y / hover.x)} wNEAR/MUT</strong>
            </div>
          </div>
        ) : null}
      </div>

      <details className="chart-table">
        <summary>Data table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Point</th>
              <th scope="col">MUT reserve</th>
              <th scope="col">wNEAR reserve</th>
              <th scope="col">Spot</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr key={row.label} className={row.post ? "post" : undefined}>
                <td>{row.label}</td>
                <td>{formatX(row.x)}</td>
                <td>{formatY(row.y)}</td>
                <td>{formatSpot(row.y / row.x)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
