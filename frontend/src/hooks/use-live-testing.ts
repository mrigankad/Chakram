import { useState, useRef, useCallback, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, RepoAnalysisResult, LiveRunStatus, AnalysisJob, PlaywrightTestCase, CommitInfo, WorkspacePlaywrightTest } from "@/lib/api";

function stripQuotes(value: string): string {
  const v = value.trim();
  if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'")) || (v.startsWith("`") && v.endsWith("`"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseSpecStepsFromBody(body: string) {
  const steps: PlaywrightTestCase["steps"] = [];
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const goto = line.match(/page\.goto\(([^)]+)\)/);
    if (goto) {
      steps.push({ action: "navigate", selector: null, value: stripQuotes(goto[1].split(",")[0] ?? ""), description: "Navigate to page" });
      continue;
    }

    const fill = line.match(/page\.fill\(([^,]+),\s*([^)]+)\)/);
    if (fill) {
      steps.push({ action: "fill", selector: stripQuotes(fill[1]), value: stripQuotes(fill[2]), description: `Fill ${stripQuotes(fill[1])}` });
      continue;
    }

    const typeInto = line.match(/page\.type\(([^,]+),\s*([^)]+)\)/);
    if (typeInto) {
      steps.push({ action: "type_into", selector: stripQuotes(typeInto[1]), value: stripQuotes(typeInto[2]), description: `Type into ${stripQuotes(typeInto[1])}` });
      continue;
    }

    const click = line.match(/page\.click\(([^)]+)\)/);
    if (click) {
      steps.push({ action: "click", selector: stripQuotes(click[1].split(",")[0] ?? ""), value: null, description: `Click ${stripQuotes(click[1].split(",")[0] ?? "")}` });
      continue;
    }

    const hover = line.match(/page\.hover\(([^)]+)\)/);
    if (hover) {
      steps.push({ action: "hover", selector: stripQuotes(hover[1]), value: null, description: `Hover ${stripQuotes(hover[1])}` });
      continue;
    }

    const press = line.match(/page\.keyboard\.press\(([^)]+)\)/);
    if (press) {
      steps.push({ action: "press", selector: null, value: stripQuotes(press[1]), description: `Press ${stripQuotes(press[1])}` });
      continue;
    }

    const check = line.match(/page\.check\(([^)]+)\)/);
    if (check) {
      steps.push({ action: "check", selector: stripQuotes(check[1]), value: null, description: `Check ${stripQuotes(check[1])}` });
      continue;
    }

    const uncheck = line.match(/page\.uncheck\(([^)]+)\)/);
    if (uncheck) {
      steps.push({ action: "uncheck", selector: stripQuotes(uncheck[1]), value: null, description: `Uncheck ${stripQuotes(uncheck[1])}` });
      continue;
    }

    const selectOption = line.match(/page\.selectOption\(([^,]+),\s*([^)]+)\)/);
    if (selectOption) {
      steps.push({ action: "select_option", selector: stripQuotes(selectOption[1]), value: stripQuotes(selectOption[2]), description: `Select option ${stripQuotes(selectOption[2])}` });
      continue;
    }

    const dbl = line.match(/page\.dblclick\(([^)]+)\)/);
    if (dbl) {
      steps.push({ action: "dblclick", selector: stripQuotes(dbl[1]), value: null, description: `Double click ${stripQuotes(dbl[1])}` });
      continue;
    }

    const wait = line.match(/page\.waitForTimeout\(([^)]+)\)/);
    if (wait) {
      const ms = stripQuotes(wait[1]);
      steps.push({ action: "wait", selector: null, value: ms, description: `Wait ${ms}ms` });
      continue;
    }

    if (/page\.screenshot\(/.test(line)) {
      steps.push({ action: "screenshot", selector: null, value: null, description: "Take screenshot" });
      continue;
    }

    const assertText = line.match(/to(ContainText|HaveText)\(([^)]+)\)/);
    if (assertText) {
      steps.push({ action: "assert_text", selector: null, value: stripQuotes(assertText[2]), description: "Assert text" });
    }
  }

  return steps;
}

function parseSpecFallback(content: string, filename: string): PlaywrightTestCase[] {
  const testRegex = /test(?:\.only|\.skip)?\(\s*(["'`])(.+?)\1\s*,\s*async\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)\}\s*\)\s*;?/g;
  const tests: PlaywrightTestCase[] = [];
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = testRegex.exec(content)) !== null) {
    const name = (match[2] || `Imported test ${i + 1}`).trim();
    const body = match[3] || "";
    const steps = parseSpecStepsFromBody(body);

    tests.push({
      id: `spec-fallback-${Date.now()}-${i}`,
      analysis_id: `spec-fallback-${Date.now()}`,
      name,
      description: name,
      page_name: filename,
      severity: "Medium",
      steps,
    });
    i += 1;
  }

  if (tests.length === 0) {
    const bodySteps = parseSpecStepsFromBody(content);
    if (bodySteps.length > 0) {
      tests.push({
        id: `spec-fallback-${Date.now()}-0`,
        analysis_id: `spec-fallback-${Date.now()}`,
        name: "Imported spec test",
        description: "Parsed from uploaded spec",
        page_name: filename,
        severity: "Medium",
        steps: bodySteps,
      });
    }
  }

  return tests;
}

export function injectCredentialsIntoTests(
  tests: PlaywrightTestCase[],
  email?: string,
  password?: string,
): PlaywrightTestCase[] {
  if (!email && !password) return tests;

  return tests.map((t) => {
    const nextSteps = t.steps.map((s) => {
      if (s.action !== "fill") return s;
      const selector = (s.selector || "").toLowerCase();
      const description = (s.description || "").toLowerCase();
      const marker = `${selector} ${description}`;

      if (email && /(email|username|user|login)/.test(marker)) {
        return { ...s, value: email, description: s.description || "Fill login email" };
      }

      if (password && /(password|pass|pwd)/.test(marker)) {
        return { ...s, value: password, description: s.description || "Fill login password" };
      }

      return s;
    });

    return { ...t, steps: nextSteps };
  });
}

/**
 * Credentials for a mixed run. Tests generated in this session ("session") were
 * written with the test account already in their steps, including deliberate
 * wrong-password cases, so they are left alone. Saved baseline tests and uploaded
 * specs carry no credentials and get the account typed into their login fields.
 */
export function injectCredentialsForRun<T extends PlaywrightTestCase>(tests: T[], email?: string, password?: string): T[] {
  if (!email && !password) return tests;
  return tests.map((test) =>
    (test as { source?: string }).source === "session"
      ? test
      : (injectCredentialsIntoTests([test], email, password)[0] as T),
  );
}

/**
 * Analyses that exist only in the browser: an uploaded spec, a direct run, or
 * tests handed over from Doc-Driven Tests / the Workspace wizard. The server has
 * no record of them, so they run through the direct endpoint with their steps.
 */
export function isLocalAnalysis(analysisId: string): boolean {
  return (
    analysisId.startsWith("spec-") ||
    analysisId.startsWith("direct-") ||
    analysisId === "workspace-handoff" ||
    analysisId === "baseline"
  );
}

// ── Fetch commits for commit-picker ──────────────────────────────────────────

export function useFetchCommits() {
  return useMutation({
    mutationFn: ({ githubUrl, pat }: { githubUrl: string; pat?: string }) => api.getRepoCommits(githubUrl, pat),
  });
}

// ── Run history ───────────────────────────────────────────────────────────────

export function useRunHistory() {
  return useQuery({
    queryKey: ["runHistory"],
    queryFn: () => api.listRunHistory(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

// ── Start analysis job ────────────────────────────────────────────────────────

export function useStartAnalyzeRepo() {
  return useMutation({
    mutationFn: ({
      githubUrl,
      targetUrl,
      testEmail,
      testPassword,
      testPreferences,
      numTests,
      mode,
      commitSha,
      commitMessage,
      pat,
    }: {
      githubUrl: string;
      targetUrl: string;
      testEmail?: string;
      testPassword?: string;
      testPreferences?: string;
      numTests?: number;
      mode?: "full" | "commit";
      commitSha?: string;
      commitMessage?: string;
      pat?: string;
    }) =>
      api.startAnalyzeRepo(
        githubUrl,
        targetUrl,
        testEmail,
        testPassword,
        testPreferences,
        numTests,
        mode,
        commitSha,
        commitMessage,
        pat,
      ),
  });
}

// ── Poll analysis job (logs + result) ─────────────────────────────────────────

export function useAnalysisJob(jobId: string | null) {
  return useQuery({
    queryKey: ["analysisJob", jobId],
    queryFn: () => api.getAnalysisJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      if (s === "completed" || s === "failed") return false;
      return 1500;
    },
    // Analysis takes minutes; keep following it when the user switches tabs.
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
}

// ── Execute Playwright tests ──────────────────────────────────────────────────

export function useExecuteRepoTests() {
  return useMutation({
    mutationFn: ({ analysisId, email, password }: { analysisId: string; email?: string; password?: string }) =>
      api.executeRepoTests(analysisId, email, password),
  });
}

// ── Poll live run status ──────────────────────────────────────────────────────

export function useLiveRunStatus(runId: string | null) {
  return useQuery({
    queryKey: ["liveRun", runId],
    queryFn: () => api.getLiveRunStatus(runId!),
    enabled: !!runId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      if (s === "completed" || s === "failed") return false;
      return 1000;
    },
    // A run takes minutes; keep following it when the user switches tabs.
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
}

// ── Composite hook ────────────────────────────────────────────────────────────

export type LiveTestingPhase = "idle" | "analyzing" | "ready" | "executing" | "done";

// ── Execute tests directly (no analysis) ─────────────────────────────────────

export function useExecuteTestsDirect() {
  return useMutation({
    mutationFn: ({ tests, targetUrl, email, password }: {
      tests: PlaywrightTestCase[];
      targetUrl: string;
      email?: string;
      password?: string;
    }) => api.executeTestsDirect(tests, targetUrl, email, password),
  });
}

// ── Upload + parse spec file ──────────────────────────────────────────────────

export function useUploadParseSpec() {
  return useMutation({
    mutationFn: (file: File) => api.uploadAndParseSpec(file),
  });
}

export function useLiveTesting() {
  const [phase, setPhase] = useState<LiveTestingPhase>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<RepoAnalysisResult | null>(null);
  const [editedTests, setEditedTests] = useState<PlaywrightTestCase[] | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Stored for spec-file runs (target URL comes from upload panel, not form)
  const [specTargetUrl, setSpecTargetUrl] = useState<string | null>(null);
  const [specAuth, setSpecAuth] = useState<{ email?: string; password?: string } | null>(null);

  const startAnalyze = useStartAnalyzeRepo();
  const executeTests = useExecuteRepoTests();
  const executeDirect = useExecuteTestsDirect();
  const uploadSpec = useUploadParseSpec();
  const jobQuery = useAnalysisJob(jobId);
  const runStatus = useLiveRunStatus(runId);
  const [analyzingSlow, setAnalyzingSlow] = useState(false);

  useEffect(() => {
    if (phase !== "analyzing") {
      setAnalyzingSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setAnalyzingSlow(true), 180_000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // Watch job completion
  const prevJobStatus = useRef<string | null>(null);
  const jobData = jobQuery.data as AnalysisJob | undefined;
  if (jobData && jobData.status !== prevJobStatus.current) {
    prevJobStatus.current = jobData.status;
    if (jobData.status === "completed" && jobData.result && phase === "analyzing") {
      setAnalysis(jobData.result);
      setEditedTests(jobData.result.tests);
      setPhase("ready");
    } else if (jobData.status === "failed" && phase === "analyzing") {
      setErrorMsg(jobData.error ?? "Analysis failed");
      setPhase("idle");
    }
  }

  // Watch run completion
  const prevRunStatus = useRef<string | null>(null);
  if (runStatus.data && runStatus.data.status !== prevRunStatus.current) {
    prevRunStatus.current = runStatus.data.status;
    if (
      (runStatus.data.status === "completed" || runStatus.data.status === "failed") &&
      phase === "executing"
    ) {
      setPhase("done");
    }
  }

  const handleAnalyze = useCallback(
    async (
      githubUrl: string,
      targetUrl: string,
      testEmail?: string,
      testPassword?: string,
      testPreferences?: string,
      numTests?: number,
      mode?: "full" | "commit",
      commitSha?: string,
      commitMessage?: string,
      pat?: string,
    ) => {
      setPhase("analyzing");
      setErrorMsg(null);
      setAnalysis(null);
      setEditedTests(null);
      setRunId(null);
      setJobId(null);
      prevJobStatus.current = null;
      // Kept in memory for this session only, so saved baseline tests added to the
      // run later can sign in with the same test account.
      setSpecAuth(testEmail || testPassword ? { email: testEmail, password: testPassword } : null);
      try {
        const res = await startAnalyze.mutateAsync({
          githubUrl,
          targetUrl,
          testEmail,
          testPassword,
          testPreferences,
          numTests,
          mode,
          commitSha,
          commitMessage,
          pat,
        });
        setJobId(res.job_id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to start analysis";
        setErrorMsg(msg);
        setPhase("idle");
      }
    },
    [startAnalyze]
  );

  const handleExecute = useCallback(async () => {
    if (!analysis) return;
    setPhase("executing");
    setErrorMsg(null);
    prevRunStatus.current = null;
    try {
      // Spec-file or direct-execution analyses are not in the DB use direct endpoint
      if (isLocalAnalysis(analysis.analysis_id)) {
        const tests = injectCredentialsIntoTests(editedTests ?? analysis.tests, specAuth?.email, specAuth?.password);
        const targetUrl = specTargetUrl ?? "";
        const res = await executeDirect.mutateAsync({
          tests, targetUrl, email: specAuth?.email, password: specAuth?.password,
        });
        setRunId(res.run_id);
      } else {
        // Generated steps hold {{TEST_EMAIL}} / {{TEST_PASSWORD}} placeholders; the
        // server fills them in the browser at run time.
        const res = await executeTests.mutateAsync({
          analysisId: analysis.analysis_id, email: specAuth?.email, password: specAuth?.password,
        });
        setRunId(res.run_id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Execution failed to start";
      setErrorMsg(msg);
      setPhase("ready");
    }
  }, [analysis, editedTests, specAuth, specTargetUrl, executeTests, executeDirect]);

  const reset = useCallback(() => {
    setPhase("idle");
    setAnalysis(null);
    setEditedTests(null);
    setJobId(null);
    setRunId(null);
    setErrorMsg(null);
    setSpecTargetUrl(null);
    setSpecAuth(null);
    prevJobStatus.current = null;
    prevRunStatus.current = null;
  }, []);

  const saveTest = useCallback(async (testId: string, updates: Partial<PlaywrightTestCase>) => {
    const updated = await api.updatePlaywrightTest(testId, updates);
    setEditedTests((prev) => prev ? prev.map((t) => t.id === testId ? { ...t, ...updated } : t) : prev);
  }, []);

  // ── Direct execution (committed tests or uploaded spec) ───────────────────

  const handleExecuteDirect = useCallback(
    async (
      tests: (PlaywrightTestCase | WorkspacePlaywrightTest)[],
      targetUrl: string,
      email?: string,
      password?: string,
    ) => {
      setPhase("executing");
      setErrorMsg(null);
      prevRunStatus.current = null;
      try {
        const runEmail = email ?? specAuth?.email;
        const runPassword = password ?? specAuth?.password;
        const normalized = injectCredentialsForRun(tests as PlaywrightTestCase[], runEmail, runPassword);
        const res = await executeDirect.mutateAsync({
          tests: normalized,
          targetUrl,
          email: runEmail,
          password: runPassword,
        });
        setRunId(res.run_id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Execution failed to start";
        setErrorMsg(msg);
        setPhase("idle");
      }
    },
    [executeDirect, specAuth]
  );

  // ── Upload spec file → parse → ready phase ────────────────────────────────

  const handleUploadSpec = useCallback(
    async (file: File, targetUrl?: string, email?: string, password?: string) => {
      setErrorMsg(null);
      if (targetUrl) setSpecTargetUrl(targetUrl);
      setSpecAuth({ email, password });
      try {
        const res = await uploadSpec.mutateAsync(file);
        let parsedTests = res.tests;

        const hasEmptySteps = parsedTests.length > 0 && parsedTests.every((t) => (t.steps?.length ?? 0) === 0);
        if (parsedTests.length === 0 || hasEmptySteps) {
          const content = await file.text();
          const fallback = parseSpecFallback(content, res.filename || file.name);
          if (fallback.length > 0) {
            parsedTests = fallback;
          }
        }

        parsedTests = injectCredentialsIntoTests(parsedTests, email, password);

        const syntheticAnalysis: RepoAnalysisResult = {
          analysis_id: `spec-${Date.now()}`,
          target_url: "",
          summary: `Imported from ${res.filename} ${parsedTests.length} test${parsedTests.length !== 1 ? "s" : ""} ready to run`,
          tech_stack: "Playwright TypeScript (uploaded spec)",
          pages: [],
          user_flows: [],
          tests: parsedTests,
        };
        setAnalysis(syntheticAnalysis);
        setEditedTests(parsedTests);
        setPhase("ready");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to parse spec file";
        setErrorMsg(msg);
      }
    },
    [uploadSpec]
  );

  return {
    phase,
    jobData,
    analysis,
    editedTests,
    saveTest,
    runId,
    runStatus: runStatus.data as LiveRunStatus | undefined,
    errorMsg,
    handleAnalyze,
    handleExecute,
    handleExecuteDirect,
    handleUploadSpec,
    reset,
    specTargetUrl,
    setSpecTargetUrl,
    /** Test account for runs of browser-only analyses; held in memory for this session only. */
    runAuth: specAuth,
    setRunAuth: setSpecAuth,
    setPhase,
    setAnalysis,
    setEditedTests,
    isStarting: startAnalyze.isPending,
    isExecuting: executeTests.isPending || executeDirect.isPending,
    isExecutingDirect: executeDirect.isPending,
    isParsingSpec: uploadSpec.isPending,
    analyzingSlow,
  };
}
