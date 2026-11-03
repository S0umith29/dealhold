"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type IRowNode,
  type ValueFormatterParams,
} from "ag-grid-community";
import { money } from "@/lib/format";
import type { Message } from "@/lib/agent";
import { ChatTranscript } from "./ChatTranscript";

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = {
  id: string;
  buyer: string;
  item: string;
  stage: string;
  bestOfferCents: number | null;
  priceCents: number;
  gapCents: number | null;
  messages: number;
  aiCalls: number;
  lastMessage: string;
  updatedAt: string;
  transcript: Message[];
};

type Sales = { held_cents: number; paid_cents: number; sold: number; share_of_ask: number | null };

type Stats = {
  buyer_messages: number | null;
  by_rules: number | null;
  ai_calls: number | null;
  input_tokens: number;
  output_tokens: number;
};

// DealHold's own colors on AG Grid's Quartz theme.
const theme = themeQuartz.withParams({
  accentColor: "#0f766e",
  backgroundColor: "#ffffff",
  foregroundColor: "#1c1917",
  borderColor: "#e7e5e4",
  headerBackgroundColor: "#fafaf9",
  headerTextColor: "#78716c",
  rowHoverColor: "#f5f5f4",
  selectedRowBackgroundColor: "#ccfbf1",
  fontFamily: "inherit",
  fontSize: 13,
  headerFontSize: 12,
  wrapperBorderRadius: 12,
});

const STAGE_STYLE: Record<string, string> = {
  "Needs you": "bg-amber-100 text-amber-800",
  "Money held": "bg-brand-soft text-brand",
  "Pickup set": "bg-brand-soft text-brand",
  Sold: "bg-brand text-white",
  Agreed: "bg-sky-100 text-sky-800",
  Talking: "bg-stone-100 text-stone-700",
  Closed: "bg-stone-100 text-stone-400",
};

function StageCell({ value, node }: ICellRendererParams<Row, string>) {
  if (node.rowPinned) return <span className="text-xs text-muted">{value}</span>;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_STYLE[value ?? ""] ?? ""}`}>{value}</span>
  );
}

const dollars = (p: ValueFormatterParams<Row, number | null>) => (p.value == null ? "–" : money(p.value));

function ago(iso: string) {
  const seconds = Math.max(0, (Date.now() - new Date(`${iso.replace(" ", "T")}Z`).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

// Stage filters: what the seller usually wants to see first.
const FILTERS: [string, (r: Row) => boolean][] = [
  ["All", () => true],
  ["Needs you", (r) => r.stage === "Needs you"],
  ["Talking", (r) => r.stage === "Talking"],
  ["Agreed or held", (r) => ["Agreed", "Money held", "Pickup set", "Sold"].includes(r.stage)],
];

// Approximate Haiku 5.5 cost: $0.10 per million input tokens, $0.50 per million output tokens.
const aiCost = (s: Stats) => (s.input_tokens * 0.1 + s.output_tokens * 0.5) / 1_000_000;

export function BuyerActivity({
  initialRows,
  initialStats,
  initialSales,
}: {
  initialRows: Row[];
  initialStats: Stats;
  initialSales: Sales;
}) {
  const [rows, setRows] = useState(initialRows);
  const [stats, setStats] = useState(initialStats);
  const [sales, setSales] = useState(initialSales);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const grid = useRef<AgGridReact<Row>>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const router = useRouter();
  const lastStages = useRef<string | null>(null);

  // Live: refresh every 3 seconds; changed cells flash.
  useEffect(() => {
    const t = setInterval(async () => {
      const res = await fetch("/api/seller/activity");
      if (!res.ok) return;
      const data = (await res.json()) as { rows: Row[]; stats: Stats; sales: Sales };
      setRows(data.rows);
      setStats(data.stats);
      setSales(data.sales);
      // A deal or question appeared or changed: refresh the cards above the grid too.
      const stages = data.rows.map((r) => `${r.id}:${r.stage}`).join("|");
      if (lastStages.current !== null && stages !== lastStages.current) router.refresh();
      lastStages.current = stages;
    }, 3000);
    return () => clearInterval(t);
  }, []);

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      { field: "buyer", headerName: "Buyer", width: 140, pinned: "left" },
      { field: "item", headerName: "Item", width: 130 },
      { field: "stage", headerName: "Stage", width: 112, cellRenderer: StageCell },
      { field: "bestOfferCents", headerName: "Their best", width: 92, valueFormatter: dollars, enableCellChangeFlash: true },
      { field: "priceCents", headerName: "Your price", width: 92, valueFormatter: dollars, enableCellChangeFlash: true },
      { field: "gapCents", headerName: "Gap", width: 70, valueFormatter: dollars, enableCellChangeFlash: true },
      { field: "messages", headerName: "Msgs", width: 66, enableCellChangeFlash: true },
      { field: "aiCalls", headerName: "AI", width: 56, enableCellChangeFlash: true },
      {
        field: "lastMessage",
        headerName: "Last message",
        flex: 1,
        minWidth: 140,
        tooltipValueGetter: (p) => `${p.value} (${p.data ? ago(p.data.updatedAt) : ""})`,
      },
    ],
    []
  );

  // Stage filter runs inside AG Grid, so sorting and search keep working on the filtered rows.
  const passes = FILTERS.find(([name]) => name === filter)![1];
  const isExternalFilterPresent = useCallback(() => filter !== "All", [filter]);
  const doesExternalFilterPass = useCallback((node: IRowNode<Row>) => (node.data ? passes(node.data) : true), [passes]);
  useEffect(() => grid.current?.api?.onFilterChanged(), [filter]);

  // Totals row pinned under the grid.
  const talking = rows.filter((r) => r.stage === "Talking");
  const gaps = talking.map((r) => r.gapCents).filter((g): g is number => g != null);
  const totals = [
    {
      id: "total",
      buyer: `${rows.length} buyers`,
      item: "",
      stage: `${talking.length} talking`,
      bestOfferCents: null,
      priceCents: null,
      gapCents: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
      messages: rows.reduce((a, r) => a + r.messages, 0),
      aiCalls: rows.reduce((a, r) => a + r.aiCalls, 0),
      lastMessage: gaps.length ? "Gap column: average for buyers still talking" : "",
    },
  ];

  const open = rows.find((r) => r.id === selected);
  const ruleHandled = stats.by_rules ?? 0;
  const moneyTiles: [string, string | number][] = [
    ["Held by PayPal now", money(sales.held_cents)],
    ["Paid to you", money(sales.paid_cents)],
    ["Items sold", sales.sold],
    ["Sold vs asking", sales.share_of_ask == null ? "–" : `${Math.round(sales.share_of_ask * 100)}%`],
  ];
  const tiles: [string, string | number][] = [
    ["Buyers", rows.length],
    ["Buyer messages", stats.buyer_messages ?? 0],
    ["Handled without AI", ruleHandled],
    ["AI cost so far", `$${aiCost(stats).toFixed(4)}`],
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[...moneyTiles, ...tiles].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-white p-3">
            <p className="text-2xl font-semibold">{value}</p>
            <p className="text-xs text-muted">{label}</p>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">No buyers yet. Share your listing link to get started.</p>
      ) : (
        <>
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map(([name, test]) => (
            <button
              key={name}
              onClick={() => setFilter(name)}
              className={`rounded-full border px-3 py-1 text-xs ${
                filter === name ? "border-brand bg-brand text-white" : "border-line bg-white text-muted hover:border-brand"
              }`}
            >
              {name} <span className="opacity-70">{rows.filter(test).length}</span>
            </button>
          ))}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search buyers and messages"
            className="ml-auto w-full rounded-lg border border-line bg-white px-3 py-1 text-xs sm:w-56"
          />
        </div>
        <div style={{ height: Math.min(122 + rows.length * 42, 420) }}>
          <AgGridReact<Row>
            ref={grid}
            theme={theme}
            rowData={rows}
            columnDefs={columns}
            defaultColDef={{ sortable: true, resizable: true }}
            quickFilterText={search}
            isExternalFilterPresent={isExternalFilterPresent}
            doesExternalFilterPass={doesExternalFilterPass}
            pinnedBottomRowData={totals}
            getRowId={(p) => p.data.id}
            rowSelection={{ mode: "singleRow", checkboxes: false, enableClickSelection: true }}
            onRowClicked={(e) => !e.rowPinned && setSelected(e.data?.id === selected ? null : (e.data?.id ?? null))}
            animateRows
            suppressCellFocus
            rowHeight={42}
          />
        </div>
        </>
      )}

      {open && (
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="flex items-center justify-between bg-paper px-4 py-2 text-sm">
            <span className="font-medium">Chat with {open.buyer}</span>
            <button onClick={() => setSelected(null)} className="text-muted hover:text-ink">
              Close
            </button>
          </div>
          <ChatTranscript messages={open.transcript} buyerName={open.buyer} />
        </div>
      )}
    </div>
  );
}
