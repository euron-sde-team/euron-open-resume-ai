/**
 * Offline interview preparation: templated per track, filled with the candidate's own
 * roles, skills and bullets. Answers are model answers or guidance on how to answer; they
 * never claim an achievement the resume does not hold.
 */
import type { InterviewGroup, InterviewTrack, ResumeDocument } from "@open-resume/types";
import { profileOf, type Profile } from "./profile";

const qa = (question: string, answer: string) => ({ question, answer });
const quote = (s: string) => `"${s.replace(/[.]+$/, "")}"`;

// ─── Non technical ──────────────────────────────────────────────────────────

function nonTechnical(p: Profile): InterviewGroup[] {
  const top = p.bullets.slice(0, 3);
  const where = p.company ? ` at ${p.company}` : "";
  const target = p.targetRole ?? p.role;
  return [
    {
      title: "Behavioural",
      items: [
        qa("Tell me about a time you disagreed with a teammate or manager. What happened?", "Use STAR. Situation: one sentence of context. Task: what you were responsible for. Action: how you listened first, put your reasoning in terms of the shared goal and proposed a way to test it. Result: the outcome and what you learned. Avoid blaming; show you can disagree and still commit."),
        qa("Describe a project that did not go as planned.", "Pick a real setback with a clear cause you owned. Spend most of your time on what you changed afterwards (a checkpoint, a test, an earlier conversation) and how the next project went better. Interviewers are scoring honesty and learning, not a flawless record."),
        qa("Tell me about a time you had to learn something quickly.", "Name the deadline and the gap, how you broke the learning into pieces, who you asked, and how you showed it worked. A small concrete example beats a general claim about being a fast learner."),
        qa("Give an example of working under a tight deadline.", "State what was at stake, how you cut scope or sequenced the work, what you communicated and to whom, and the result. Show prioritisation, not heroics."),
        qa("Tell me about a time you led without formal authority.", "Describe the goal nobody owned, how you gathered people around it, how you made it easy for them to help, and what shipped. Credit the team and be specific about your own part."),
      ],
    },
    {
      title: "About your experience",
      items: [
        qa(`Walk me through your work as ${p.role}${where}. What did you own?`, `Give a 90-second arc: scope and team size in one line, the two or three things you owned, one result you are proud of, and what you want next. ${top[0] ? `Anchor it on your own evidence, for example ${quote(top[0])}.` : "Anchor it on one concrete piece of work you can describe in detail."}`),
        ...top.map((b) => qa(`Your resume says ${quote(b)}. What was the hardest part, and what would you do differently?`, "Explain the problem before the solution, the options you weighed and why you chose one, and one thing you would change with hindsight. Be ready for a follow-up on how you measured the outcome; if you have no number, describe the signal you used instead.")),
        qa("Why are you looking for a new role?", "Keep it forward-looking: what you have learned, what you want to do more of, and why this role is the next step. Do not criticise a current or former employer."),
      ],
    },
    {
      title: "Motivation and fit",
      items: [
        qa(p.jobCompany ? `Why ${p.jobCompany}, and why this role?` : `Why are you interested in the ${target} role?`, `${p.jobCompany ? `Show you read about ${p.jobCompany}: its product, customers or stated priorities. ` : ""}Connect two requirements in the job description to things you have actually done, and say what you would want to learn.`),
        qa("What are your greatest strengths and one weakness?", "Choose strengths you can back with a short example from your resume. For the weakness, pick a real, non-critical one, and describe the habit you built to manage it."),
        qa("Where do you want to be in three to five years?", `Describe growth in skill and scope that this role can offer${p.level === "entry" ? ", such as owning a feature end to end and mentoring newer people" : p.level === "senior" ? ", such as broader technical direction and developing others" : ", such as leading larger pieces of work"}. It should sound ambitious but compatible with the job.`),
        qa("What questions do you have for us?", "Ask about how success is measured in the first six months, how the team makes decisions and handles disagreement, what the biggest current challenge is, and how feedback is given. Avoid questions the careers page answers."),
      ],
    },
  ];
}

// ─── DSA ────────────────────────────────────────────────────────────────────

type Lang = "python" | "javascript";

const CODE: Record<string, Record<Lang, string>> = {
  twoSum: {
    python: `def two_sum(nums, target):\n    seen = {}\n    for i, x in enumerate(nums):\n        if target - x in seen:\n            return [seen[target - x], i]\n        seen[x] = i\n    return []`,
    javascript: `function twoSum(nums, target) {\n  const seen = new Map();\n  for (let i = 0; i < nums.length; i++) {\n    const need = target - nums[i];\n    if (seen.has(need)) return [seen.get(need), i];\n    seen.set(nums[i], i);\n  }\n  return [];\n}`,
  },
  window: {
    python: `def longest_unique(s):\n    last, start, best = {}, 0, 0\n    for i, ch in enumerate(s):\n        if ch in last and last[ch] >= start:\n            start = last[ch] + 1\n        last[ch] = i\n        best = max(best, i - start + 1)\n    return best`,
    javascript: `function longestUnique(s) {\n  const last = new Map();\n  let start = 0, best = 0;\n  for (let i = 0; i < s.length; i++) {\n    if (last.has(s[i]) && last.get(s[i]) >= start) start = last.get(s[i]) + 1;\n    last.set(s[i], i);\n    best = Math.max(best, i - start + 1);\n  }\n  return best;\n}`,
  },
  parens: {
    python: `def is_valid(s):\n    pairs = {')': '(', ']': '[', '}': '{'}\n    stack = []\n    for ch in s:\n        if ch in pairs:\n            if not stack or stack.pop() != pairs[ch]:\n                return False\n        else:\n            stack.append(ch)\n    return not stack`,
    javascript: `function isValid(s) {\n  const pairs = { ')': '(', ']': '[', '}': '{' };\n  const stack = [];\n  for (const ch of s) {\n    if (pairs[ch]) {\n      if (stack.pop() !== pairs[ch]) return false;\n    } else stack.push(ch);\n  }\n  return stack.length === 0;\n}`,
  },
  bfs: {
    python: `from collections import deque\n\ndef shortest_path(graph, start, goal):\n    queue, seen = deque([(start, 0)]), {start}\n    while queue:\n        node, dist = queue.popleft()\n        if node == goal:\n            return dist\n        for nxt in graph.get(node, []):\n            if nxt not in seen:\n                seen.add(nxt)\n                queue.append((nxt, dist + 1))\n    return -1`,
    javascript: `function shortestPath(graph, start, goal) {\n  const queue = [[start, 0]];\n  const seen = new Set([start]);\n  for (let head = 0; head < queue.length; head++) {\n    const [node, dist] = queue[head];\n    if (node === goal) return dist;\n    for (const next of graph[node] || []) {\n      if (!seen.has(next)) {\n        seen.add(next);\n        queue.push([next, dist + 1]);\n      }\n    }\n  }\n  return -1;\n}`,
  },
  coins: {
    python: `def min_coins(coins, amount):\n    INF = amount + 1\n    dp = [0] + [INF] * amount\n    for a in range(1, amount + 1):\n        for c in coins:\n            if c <= a:\n                dp[a] = min(dp[a], dp[a - c] + 1)\n    return dp[amount] if dp[amount] != INF else -1`,
    javascript: `function minCoins(coins, amount) {\n  const INF = amount + 1;\n  const dp = [0, ...Array(amount).fill(INF)];\n  for (let a = 1; a <= amount; a++) {\n    for (const c of coins) if (c <= a) dp[a] = Math.min(dp[a], dp[a - c] + 1);\n  }\n  return dp[amount] === INF ? -1 : dp[amount];\n}`,
  },
  lru: {
    python: `from collections import OrderedDict\n\nclass LRUCache:\n    def __init__(self, capacity):\n        self.cap, self.data = capacity, OrderedDict()\n\n    def get(self, key):\n        if key not in self.data:\n            return -1\n        self.data.move_to_end(key)\n        return self.data[key]\n\n    def put(self, key, value):\n        self.data[key] = value\n        self.data.move_to_end(key)\n        if len(self.data) > self.cap:\n            self.data.popitem(last=False)`,
    javascript: `class LRUCache {\n  constructor(capacity) {\n    this.cap = capacity;\n    this.data = new Map();\n  }\n  get(key) {\n    if (!this.data.has(key)) return -1;\n    const v = this.data.get(key);\n    this.data.delete(key);\n    this.data.set(key, v);\n    return v;\n  }\n  put(key, value) {\n    this.data.delete(key);\n    this.data.set(key, value);\n    if (this.data.size > this.cap) this.data.delete(this.data.keys().next().value);\n  }\n}`,
  },
};

function pickLang(p: Profile): Lang {
  const t = p.terms.join(" ");
  if (/python/.test(t)) return "python";
  if (/javascript|typescript|node\.js|react/.test(t)) return "javascript";
  return "python";
}

function dsa(p: Profile): InterviewGroup[] {
  const lang = pickLang(p);
  const fence = (k: string) => CODE[k]![lang];
  const groups: InterviewGroup[] = [
    {
      title: "Arrays and hashing",
      items: [
        qa("Given an array of integers and a target, return the indices of two numbers that add up to the target.", `Approach: one pass with a hash map from value to index; for each x look up target - x before inserting x. Time O(n), space O(n). The brute force is O(n^2); sorting first costs O(n log n) and loses the original indices. Edge cases: duplicates (x + x = target), no answer, empty input.\n\n${fence("twoSum")}`),
        qa("When would you choose a hash map over a sorted array or a balanced tree?", "A hash map gives average O(1) lookup and insert but no ordering; use it for membership, counting and joins by key. Use a sorted array when the data is static and you need range queries or binary search; use a balanced tree (or ordered map) when you need ordered iteration, predecessor/successor or range queries under inserts. Mention worst-case collisions and resizing cost."),
      ],
    },
    {
      title: "Strings and sliding windows",
      items: [qa("Find the length of the longest substring without repeating characters.", `Maintain a window [start, i] and a map from character to its last index; when the current character was seen inside the window, move start past it. Each index is visited once: O(n) time, O(k) space for k distinct characters. Edge cases: empty string, all identical characters.\n\n${fence("window")}`)],
    },
    {
      title: "Stacks and graphs",
      items: [
        qa("Check whether a string of brackets is balanced.", `Push openers; on a closer, the top of the stack must be its matching opener. At the end the stack must be empty. O(n) time, O(n) space.\n\n${fence("parens")}`),
        qa("Return the shortest number of edges between two nodes of an unweighted graph.", `Breadth-first search from the start with a visited set; the first time you reach the goal is the shortest distance. O(V + E) time and O(V) space. Use Dijkstra when edges have weights, and 0-1 BFS when weights are 0 or 1.\n\n${fence("bfs")}`),
      ],
    },
    {
      title: "Dynamic programming",
      items: [qa("Given coin denominations and an amount, find the fewest coins that make the amount.", `Let dp[a] be the fewest coins for amount a; dp[a] = min over coins c <= a of dp[a - c] + 1, with dp[0] = 0. O(amount x coins) time, O(amount) space. A greedy choice fails for some denominations (for example 1, 3, 4 and amount 6). Return -1 when unreachable.\n\n${fence("coins")}`)],
    },
  ];
  if (p.level !== "entry") {
    groups.push({
      title: "Design with data structures",
      items: [qa("Implement an LRU cache with O(1) get and put.", `Combine a hash map with a doubly linked list (or use an ordered map): the map finds the entry, the list keeps recency order; on access move to the front, on overflow evict from the back. Discuss thread safety (a lock or sharding) and how it differs from LFU.\n\n${fence("lru")}`)],
    });
  }
  groups.push({
    title: "Complexity and trade-offs",
    items: [qa("How do you decide between a heap, a sorted structure and a hash map for a top-k problem?", "For top-k of a stream use a size-k min-heap: O(n log k) time and O(k) space. If the data is static and k is large, sorting once (O(n log n)) or quickselect (average O(n)) can win. A hash map only helps for counting frequencies first. State the constraint that drives your choice: stream or batch, k relative to n, memory.")],
  });
  return groups;
}

// ─── Programming ────────────────────────────────────────────────────────────

const TECH: Record<string, { title: string; items: [string, string][] }> = {
  javascript: { title: "JavaScript", items: [["Explain closures and a bug they commonly cause.", "A closure is a function that keeps access to the variables of the scope it was created in. A classic bug is creating functions in a loop with var, so every callback sees the final value; let creates a binding per iteration. Closures also back module patterns, memoisation and event handlers, and can leak memory if they hold large objects."], ["How does the event loop order promises, timers and rendering?", "Synchronous code runs to completion, then the microtask queue (promise callbacks, queueMicrotask) drains fully, then one macrotask (timer, I/O) runs, and the browser may render between tasks. So a resolved promise callback runs before a setTimeout of 0."]] },
  typescript: { title: "TypeScript", items: [["What is the difference between unknown and any, and when do you use generics?", "any switches type checking off; unknown forces you to narrow before use, so it is the safe type for untrusted input. Generics let one function or type work over many types while keeping the relationship between them, for example a function that returns the same type it receives."], ["How do discriminated unions help model state?", "A shared literal field (such as status) lets the compiler narrow the union in a switch, and an exhaustiveness check with never catches unhandled cases when a variant is added. They make impossible states unrepresentable."]] },
  react: { title: "React", items: [["When does a component re-render, and how do you avoid unnecessary renders?", "On state or prop changes and when its parent renders. Fix the cause first: colocate state, avoid creating new object props inline for memoised children, and split components. Then use memo, useMemo and useCallback where profiling shows a cost. Keys must be stable for lists."], ["What are the rules of hooks and why do they exist?", "Call hooks at the top level and only from components or other hooks. React tracks hook state by call order per render, so conditional calls would shift the order and mix up state. Effects need correct dependency arrays and cleanups."]] },
  "node.js": { title: "Node.js", items: [["How does Node handle many concurrent connections with one thread?", "It uses non-blocking I/O with an event loop and delegates work to the OS and a small thread pool. CPU-bound work blocks the loop, so move it to worker threads or a separate service. Always handle backpressure on streams."], ["How would you structure error handling in an Express or similar service?", "Validate input at the edge, throw typed errors from services, and use one error-handling middleware that maps them to status codes and logs with a request id. Wrap async handlers so rejections reach it, and never leak internals to clients."]] },
  python: { title: "Python", items: [["What do generators give you, and when would you use one?", "A generator produces values lazily with yield, so you can stream large or infinite sequences in constant memory and compose pipelines. Use them for file processing and paginated APIs; use a list when you need random access or multiple passes."], ["Explain the GIL and how you work around it.", "The global interpreter lock lets one thread run Python bytecode at a time, so threads do not speed up CPU-bound code. Use multiprocessing or native extensions for CPU work and threads or asyncio for I/O-bound work."]] },
  java: { title: "Java", items: [["What contract must equals and hashCode keep, and what breaks if you violate it?", "Equal objects must have equal hash codes, and both must be consistent over time. Violations make HashMap and HashSet lose entries or hold duplicates. Do not use mutable fields in hashCode for keys."], ["How do the JVM garbage collector and memory model affect a latency-sensitive service?", "Pauses come from collection cycles, so pick a collector for the goal (throughput versus low latency), size the heap from measurements, avoid allocation churn in hot paths and watch for leaks via long-lived references. Visibility between threads needs volatile, locks or atomics."]] },
  sql: { title: "SQL and databases", items: [["How do indexes speed up queries and what do they cost?", "An index (usually a B-tree) lets the database find rows without scanning the table, and supports ordering and range scans. Costs are extra storage and slower writes. Put the most selective, most filtered columns first in composite indexes and confirm with EXPLAIN."], ["Explain the difference between INNER, LEFT and FULL joins, and how you would find duplicates.", "INNER keeps rows that match on both sides, LEFT keeps every left row with nulls where no match exists, FULL keeps both sides. For duplicates, GROUP BY the key columns with HAVING COUNT(*) > 1."]] },
  docker: { title: "Docker", items: [["What goes into a good production Dockerfile?", "A small pinned base image, multi-stage builds so build tools stay out of the final image, dependency layers ordered for cache reuse, a non-root user, no secrets baked in, and a health check."], ["How is a container different from a virtual machine?", "Containers share the host kernel and isolate processes with namespaces and cgroups, so they start fast and are light; a VM runs a full guest OS on virtual hardware, giving stronger isolation at higher cost."]] },
  kubernetes: { title: "Kubernetes", items: [["How do liveness, readiness and startup probes differ?", "Readiness decides whether a pod receives traffic, liveness restarts a stuck container, and startup delays the other two for slow starters. A bad liveness probe can cause restart loops, so keep it cheap and independent of dependencies."], ["How would you roll out a change safely?", "Use a rolling update with sensible maxSurge and maxUnavailable, readiness gates, resource requests and limits, and an automated rollback on failed health checks. For riskier changes use canary or blue-green."]] },
  aws: { title: "AWS", items: [["How do you secure access between services on AWS?", "Give each workload its own IAM role with least-privilege policies, avoid long-lived keys, keep resources in private subnets with security groups that allow only needed ports, encrypt data at rest and in transit, and log with CloudTrail."], ["When would you choose Lambda over containers?", "Lambda suits spiky, short, event-driven work with no server management; containers suit steady load, long-running processes, custom runtimes and predictable cost. Consider cold starts, concurrency limits and local testing."]] },
  git: { title: "Git and collaboration", items: [["Merge versus rebase: when do you use each?", "Rebase rewrites your local branch on top of the latest main for a linear history, and is safe only for commits not yet shared. Merge preserves history and is right for shared branches. Squash merging keeps main readable."], ["How do you recover a commit you think you lost?", "git reflog lists where HEAD has been, so you can check out or reset to the lost commit; create a branch at it before doing anything else."]] },
  django: { title: "Django", items: [["How do you avoid the N+1 query problem in the ORM?", "Use select_related for foreign keys and prefetch_related for many-to-many or reverse relations, check with the debug toolbar or query logging, and push aggregation into the database."], ["How do migrations work in a team, and what makes one unsafe?", "Each migration is a versioned schema change applied in order. Unsafe ones lock big tables, drop columns still read by running code, or add non-null columns without defaults; split them across deploys."]] },
  spring: { title: "Spring", items: [["Explain dependency injection and why constructor injection is preferred.", "The container creates and wires objects so classes depend on interfaces rather than constructing collaborators. Constructor injection makes dependencies explicit and required, supports immutability and makes unit tests simple."], ["How does @Transactional behave, and what are its pitfalls?", "It wraps a method in a transaction through a proxy, so self-invocation bypasses it, checked exceptions do not roll back by default, and propagation settings decide how nested calls join."]] },
  golang: { title: "Go", items: [["How do goroutines and channels differ from threads and locks?", "Goroutines are cheap, multiplexed by the runtime; channels pass ownership of data between them so you share memory by communicating. Use mutexes for protecting simple shared state and always plan goroutine exit with context cancellation."], ["How do you handle errors idiomatically in Go?", "Return errors as values, wrap with context using %w so callers can use errors.Is and errors.As, and handle them where you can act on them rather than logging and returning."]] },
  "rest api": { title: "APIs", items: [["How do you design an idempotent, evolvable REST API?", "Use resource-oriented URLs and correct verbs, make PUT and DELETE idempotent, accept an idempotency key on POST that creates, return stable error shapes, paginate with cursors, and version by adding fields compatibly before introducing a new version."], ["How would you secure a public API?", "Authenticate every call, authorise per resource, validate input, rate limit by caller, keep tokens short lived, log without secrets, and set strict CORS and TLS."]] },
  mongodb: { title: "MongoDB", items: [["How do you decide between embedding and referencing documents?", "Embed data that is read together and bounded in size; reference data that grows without bound, is shared, or changes independently. Remember the 16 MB document limit and the cost of multi-document transactions."], ["How do you find and fix a slow query?", "Use explain to see whether it scans a collection, add a compound index matching the filter then sort order, and project only needed fields."]] },
};

const ALIASES: [RegExp, string][] = [
  [/^(postgres|postgresql|mysql|sql|sqlite|oracle)$/, "sql"],
  [/^(golang)$/, "golang"],
  [/^(spring boot|spring)$/, "spring"],
  [/^(next\.js|react native|redux)$/, "react"],
  [/^(restful|rest api|graphql)$/, "rest api"],
  [/^(express\.js|nestjs)$/, "node.js"],
  [/^(flask|fastapi)$/, "python"],
];

function techKeys(p: Profile): string[] {
  const keys: string[] = [];
  // In the order the resume mentions them, so the candidate's headline technologies come first.
  const text = [p.role, ...p.skills, ...p.bullets].join(" ").toLowerCase();
  const at = (t: string) => {
    const i = text.indexOf(t);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  for (const t of [...p.terms].sort((a, b) => at(a) - at(b))) {
    const alias = ALIASES.find(([re]) => re.test(t))?.[1];
    const k = alias ?? t;
    if (TECH[k] && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

function programming(p: Profile): InterviewGroup[] {
  const keys = techKeys(p).slice(0, 5);
  const groups: InterviewGroup[] = keys.map((k) => ({ title: TECH[k]!.title, items: TECH[k]!.items.map(([q, a]) => qa(q, a)) }));
  const sample = p.bullets[0];
  groups.push({
    title: "Engineering practice",
    items: [
      qa("How do you decide what to test, and at which level?", "Test behaviour that would hurt if it broke: many fast unit tests for logic, fewer integration tests across real boundaries (database, queue, HTTP), and a handful of end-to-end paths for critical journeys. Keep tests deterministic, and treat flaky tests as bugs."),
      qa("Walk me through how you debug a production issue you cannot reproduce locally.", "Stabilise first (roll back or mitigate), then gather evidence: logs with request ids, metrics, traces and recent deploys. Form a hypothesis, narrow it with a targeted log or feature flag, write a failing test once you can reproduce, fix, and follow up with a short write-up and a guard against recurrence."),
      qa("What do you look for in a code review, and how do you give feedback?", "Correctness and edge cases first, then clarity, tests, security and operational impact; style is for tools. Be specific, explain why, separate must-fix from suggestions, and ask questions where unsure."),
      ...(sample ? [qa(`You wrote ${quote(sample)}. Take me through the technical decisions behind it.`, "Describe the constraints, the alternatives you considered and why you rejected them, how you tested it, and what you would change now. Be ready to go one level deeper on any technology you named.")] : []),
    ],
  });
  if (!keys.length) groups.unshift({ title: "Fundamentals", items: [qa("What makes code easy to change?", "Small cohesive units, clear names, explicit dependencies, tests that pin behaviour, and avoiding premature abstraction. Say how you applied these in a recent project.")] });
  return groups;
}

// ─── System design ──────────────────────────────────────────────────────────

function systemDesign(p: Profile): InterviewGroup[] {
  const groups: InterviewGroup[] = [
    {
      title: "Fundamentals",
      items: [
        qa("How do you scale a read-heavy service versus a write-heavy one?", "Reads: caching (CDN, application, database), read replicas, denormalised views. Writes: batching, queues to smooth bursts, partitioning (sharding) by a key with even distribution, and append-only designs. State the consistency you give up at each step."),
        qa("Explain cache invalidation strategies and their failure modes.", "TTLs bound staleness; write-through keeps the cache updated with the write; cache-aside loads on a miss; explicit invalidation on update is precise but easy to miss. Watch for stampedes (use request coalescing or jittered TTLs) and for caching errors."),
        qa("How do you choose between SQL and NoSQL storage?", "Start from the access patterns and consistency needs: relational for joins, transactions and evolving queries; key-value or document stores for known lookups at large scale; wide-column or log stores for write-heavy time series. Many systems use both."),
        qa("What does the CAP theorem mean in practice?", "During a network partition you must choose between consistency and availability. Most real systems pick per operation: for example strong consistency for payments, eventual consistency for feeds. Mention PACELC for the no-partition trade-off between latency and consistency."),
      ],
    },
    {
      title: "Design problems",
      items: [
        qa("Design a URL shortener.", "Requirements: create and redirect, high read volume, optional expiry. API: POST /links, GET /{code}. Generate short codes from a counter encoded in base62 (or random with collision check). Store code -> URL in a key-value or relational table; cache hot codes; redirect with 301/302 depending on analytics needs. Scale reads with a CDN and replicas; shard by code. Discuss abuse, expiry and analytics through an async log pipeline."),
        qa("Design a rate limiter for a public API.", "Pick an algorithm: token bucket (burst friendly) or sliding window counters. Keep counters in a shared fast store such as Redis with atomic operations, keyed by caller and route; return 429 with Retry-After. Handle clock skew, store outages (fail open or closed by route) and limits per tier."),
        qa("Design a notification service (email, push, in-app).", "Producers publish events to a queue; a router resolves user preferences and channels; per-channel workers send with retries, backoff and idempotency keys; provider failover; templates and localisation; rate limits and quiet hours; delivery tracking; a dead-letter queue and replay."),
        ...(p.level !== "entry" ? [qa("Design a news feed or activity timeline.", "Fan-out on write precomputes each follower's timeline (fast reads, heavy for accounts with many followers); fan-out on read computes at request time (cheap writes, slower reads). Hybrid: precompute for normal accounts, merge in high-follower accounts at read time. Cache timelines, paginate with cursors, rank asynchronously.")] : []),
      ],
    },
    {
      title: "Your own systems",
      items: [
        qa(`Describe the architecture of the most complex system you worked on${p.company ? ` at ${p.company}` : ""}.`, "Draw the components and data flow, name the load and the constraints, explain two decisions you made and the alternatives, and say how you monitored it. Be honest about parts you did not own."),
        qa("What was the biggest scaling or reliability problem you faced, and how did you fix it?", "Use a real incident: the symptom, how you found the cause, the fix, and the permanent prevention (alerts, limits, tests). If you have not faced one, describe how you would load test and find the first bottleneck."),
      ],
    },
  ];
  return groups;
}

export function interviewOffline(track: InterviewTrack, doc: ResumeDocument, job: { jd?: string; company?: string } = {}): InterviewGroup[] {
  const p = profileOf(doc, job);
  switch (track) {
    case "non_technical":
      return nonTechnical(p);
    case "dsa":
      return dsa(p);
    case "programming":
      return programming(p);
    case "system_design":
      return systemDesign(p);
  }
}
