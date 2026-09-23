# Experiment records

This directory is for **measured** router, dialogue, and voice experiments. It is separate from the root README so the judge gets a short reproducible project entry point while the decision history remains inspectable. **No experiment has been run for this repository yet.**

Create one dated Markdown record per decision-relevant run, using [TEMPLATE.md](TEMPLATE.md). Mark it planned, running, failed, or completed. Record exact model IDs, prompt/configuration and catalogue revisions, input IDs, command, evaluator output, stage timings, and provider-reported usage. Do not fill empty fields with illustrative values or silently change a failed run into a passing one. If a service/key is unavailable, record the blocker plainly.

Initial candidate comparisons are the OpenAI LLM baseline, Jev Choice, Jev→LLM and parallel hybrid, sequential replay of the ten supplied dialogues, chained voice, Realtime 2.1, and GPT-Live 1 delegation. Later experiments are conditional: run only those that could change the implementation choice. Compare by language and failure class, compound-intent retention, median/p95 stage latency, meaningful first-audio latency, and actual cost. Preserve the official development set; do not hard-code evaluation utterances. The jury's hidden inputs are unavailable.

Link raw predictions/traces only when safe to publish. Never commit API keys, real customer data, or private call recordings.
