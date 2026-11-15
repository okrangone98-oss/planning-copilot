import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/**
 * 내용 길이에 맞춰 높이가 늘어나는 입력칸.
 *
 * 검토 표의 칸에 긴 문장을 넣으면 기본 textarea 는 한 줄 높이에 머물러 글의 나머지가 가려졌다.
 * 처음 그려질 때, 타이핑할 때, 밖에서 값이 바뀔 때(저장값 복원·다른 칸 값 복사) 모두 다시 재고,
 * 화면 폭이 바뀌면(회전·키보드) 줄바꿈이 달라지므로 그때도 다시 잰다.
 */
export function AutoGrowTextarea({
  value,
  onChange,
  ariaLabel,
  className = "",
  placeholder = "",
  maxHeight = 0,
  disabled = false
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  placeholder?: string;
  /** 0 이면 내용만큼 끝없이 늘어난다. 값이 있으면 그 높이를 넘을 때 안에서 스크롤한다. */
  maxHeight?: number;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const lastWidth = useRef(0);

  const fit = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    // 접힌 details 안에서는 높이가 0으로 재어진다 — 그때 잰 값을 쓰면 칸이 사라진다.
    if (!element.scrollHeight) return;
    element.style.height = "auto";
    const border = Math.max(0, element.offsetHeight - element.clientHeight);
    const next = element.scrollHeight + border;
    element.style.height = `${next}px`;
    if (maxHeight > 0) element.style.overflowY = next > maxHeight ? "auto" : "hidden";
  }, [maxHeight]);

  // 처음 그리기·값 변경(입력 포함)·되돌리기 모두 여기서 높이를 다시 잡는다.
  useLayoutEffect(() => {
    fit();
  }, [fit, value]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    let observer: ResizeObserver | null = null;
    let intersection: IntersectionObserver | null = null;
    if (typeof ResizeObserver === "function" && element.parentElement) {
      observer = new ResizeObserver((entries) => {
        const width = Math.round(entries[0]?.contentRect?.width ?? 0);
        if (!width || width === lastWidth.current) return;
        lastWidth.current = width;
        fit();
      });
      observer.observe(element.parentElement);
    }
    // 접혀 있다 펼쳐진 칸(빈칸 목록 등)은 보이는 순간 다시 잰다.
    if (typeof IntersectionObserver === "function") {
      intersection = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) fit();
      });
      intersection.observe(element);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
      intersection?.disconnect();
    };
  }, [fit]);

  return (
    <textarea
      ref={ref}
      rows={1}
      className={className}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onFocus={(event) => {
        // 모바일에서 키보드가 올라오면 칸이 화면 밖으로 밀릴 수 있다 — 보이는 자리로 당긴다.
        event.currentTarget.scrollIntoView({ block: "nearest" });
      }}
    />
  );
}
