"use client";

import React, { useEffect, useRef } from "react";
import { Recommendation } from "@/domain/types";
import { RECOMMENDATION_LABEL } from "@/ai/rules";
import { parseMoneyToFen } from "@/domain/money";

const STYLE: Record<Recommendation, string> = {
  BUY: "green",
  NEGOTIATE: "orange",
  REJECT: "red",
  REWORK: "orange",
  NEEDS_DATA: "gray",
  INVALID: "red",
};

export function RecommendationBadge({ value }: { value: Recommendation }) {
  return (
    <span className={`badge ${STYLE[value]}`}>
      {RECOMMENDATION_LABEL[value]}
    </span>
  );
}

export function StatusBadge({ status }: { status: "new" | "evaluating" | "decided" }) {
  const map = {
    new: ["gray", "资料待补"],
    evaluating: ["blue", "评估中"],
    decided: ["green", "已决策"],
  } as const;
  const [cls, label] = map[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        style={wide ? { maxWidth: 960 } : undefined}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>{title}</h2>
          <button className="btn sm" onClick={onClose} aria-label="关闭">
            关闭 Esc
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 金额输入（元，最多两位小数；非法输入行内报错并上送表单层）。 */
export function MoneyField({
  label,
  valueFen,
  onChange,
  disabled,
  hint,
  onValidityChange,
}: {
  label: string;
  valueFen: number;
  onChange: (fen: number) => void;
  disabled?: boolean;
  hint?: string;
  /** 非法编辑状态上送：非法时传错误文案，恢复合法/外部值重置时传 null */
  onValidityChange?: (error: string | null) => void;
}) {
  const [text, setText] = React.useState<string>((valueFen / 100).toFixed(2));
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  const validityRef = React.useRef(onValidityChange);
  validityRef.current = onValidityChange;
  useEffect(() => {
    setText((valueFen / 100).toFixed(2));
    setError(null);
    validityRef.current?.(null);
  }, [valueFen]);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        className={error ? "invalid" : undefined}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          const parsed = parseMoneyToFen(v);
          if (parsed.ok) {
            setError(null);
            validityRef.current?.(null);
            onChange(parsed.fen);
          } else {
            // 非法输入不进入父状态：父层保留最后合法值，必须知情并阻断确认/保存
            setError(parsed.message);
            validityRef.current?.(parsed.message);
          }
        }}
      />
      {error ? <span className="error-text">{error}</span> : hint ? <span className="small muted">{hint}</span> : null}
    </div>
  );
}

/** 非负整数输入。非法编辑状态同样上送表单层。 */
export function IntField({
  label,
  value,
  onChange,
  disabled,
  hint,
  onValidityChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  hint?: string;
  onValidityChange?: (error: string | null) => void;
}) {
  const [text, setText] = React.useState<string>(String(value));
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  const validityRef = React.useRef(onValidityChange);
  validityRef.current = onValidityChange;
  useEffect(() => {
    setText(String(value));
    setError(null);
    validityRef.current?.(null);
  }, [value]);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={text}
        disabled={disabled}
        className={error ? "invalid" : undefined}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          if (/^\d+$/.test(v.trim())) {
            const n = Number(v.trim());
            if (Number.isSafeInteger(n)) {
              setError(null);
              validityRef.current?.(null);
              onChange(n);
              return;
            }
          }
          setError("须为非负整数");
          validityRef.current?.("须为非负整数");
        }}
      />
      {error ? <span className="error-text">{error}</span> : hint ? <span className="small muted">{hint}</span> : null}
    </div>
  );
}
