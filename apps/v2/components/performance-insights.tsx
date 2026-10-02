"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import {
  completeRoutePerformance,
  reportFrontendPerformance,
} from "@/lib/performance";

export function PerformanceInsights() {
  const pathname = usePathname();

  useEffect(() => {
    completeRoutePerformance(pathname);
  }, [pathname]);

  useEffect(() => {
    let longTaskCount = 0;
    let longTaskTotalMs = 0;
    let longestTaskMs = 0;
    let observer: PerformanceObserver | undefined;

    const reportPageLoad = () => {
      const navigation = performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming | undefined;
      if (navigation) {
        reportFrontendPerformance({
          operation: "page_load",
          outcome: "complete",
          durationMs: navigation.duration,
          properties: {
            ttfb_ms: navigation.responseStart,
            dom_interactive_ms: navigation.domInteractive,
            dom_content_loaded_ms: navigation.domContentLoadedEventEnd,
            transfer_bytes: navigation.transferSize,
          },
        });
      }

      const resources = performance.getEntriesByType(
        "resource",
      ) as PerformanceResourceTiming[];
      if (resources.length > 0) {
        const slowest = resources.reduce((current, entry) =>
          entry.duration > current.duration ? entry : current,
        );
        reportFrontendPerformance({
          operation: "page_resources",
          outcome: "complete",
          durationMs: slowest.duration,
          properties: {
            resource_count: resources.length,
            transfer_bytes: resources.reduce(
              (total, entry) => total + entry.transferSize,
              0,
            ),
            slowest_type: slowest.initiatorType,
          },
        });
      }
    };

    const flushLongTasks = () => {
      if (longTaskCount === 0) return;
      reportFrontendPerformance({
        operation: "long_tasks",
        outcome: "complete",
        durationMs: longTaskTotalMs,
        properties: {
          count: longTaskCount,
          longest_ms: Math.round(longestTaskMs * 100) / 100,
        },
      });
      longTaskCount = 0;
      longTaskTotalMs = 0;
      longestTaskMs = 0;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushLongTasks();
    };

    if (document.readyState === "complete") {
      window.setTimeout(reportPageLoad, 0);
    } else {
      window.addEventListener("load", reportPageLoad, { once: true });
    }

    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTaskCount += 1;
          longTaskTotalMs += entry.duration;
          longestTaskMs = Math.max(longestTaskMs, entry.duration);
        }
      });
      observer.observe({ type: "longtask", buffered: true });
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flushLongTasks);
    return () => {
      observer?.disconnect();
      window.removeEventListener("load", reportPageLoad);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flushLongTasks);
    };
  }, []);

  return null;
}
