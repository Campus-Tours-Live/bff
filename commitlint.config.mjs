// Enforce Conventional Commits + a required Jira ticket on the commit-msg hook.
// Format: <type>(<scope>)?: <BOARD>-<NUMBER> <description>
//   - <type>:   feat | fix | docs | style | refactor | perf | test | build | ci | chore | revert
//   - <BOARD>:  Jira board key (uppercase), e.g. CTL
//   - <NUMBER>: Jira ticket number, e.g. 1234
// e.g. "feat: CTL-1234 add Google OIDC callback", "fix(proxy): CTL-987 handle upstream 502".
const JIRA_TICKET = /^[A-Z][A-Z0-9]+-\d+\s+\S/;

export default {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        "jira-ticket-required": ({ subject }) => [
          typeof subject === "string" && JIRA_TICKET.test(subject),
          'subject must start with a Jira ticket: "<BOARD>-<NUMBER> <description>", e.g. "CTL-1234 add login"',
        ],
      },
    },
  ],
  rules: {
    "jira-ticket-required": [2, "always"],
    // The uppercase Jira prefix confuses commitlint's subject-case detector; disable it.
    "subject-case": [0],
  },
};
