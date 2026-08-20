# Simplified Technical English style

Use this project writing profile for all author-facing YAML prose and Markdown.
It is based on core ASD-STE100 Issue 9 writing rules. It is not a controlled
dictionary, and it does not claim ASD-STE100 certification or compliance.

Reference basis:

- https://www.asd-ste100.org/
- https://www.asd-ste100.org/STE_faq.html

## Rules

- Use short, direct sentences. Limit procedural sentences to 20 words and
  descriptive sentences to 25 words.
- State one instruction or one main fact in each sentence. Use active voice.
- Use simple verb forms. Prefer a direct verb to a noun made from a verb.
- Use clear, concrete words. Do not use idioms, vague intensifiers, or
  unnecessary synonyms.
- Keep noun groups short. Use no more than three consecutive nouns when a
  clearer sentence can express the meaning.
- Use articles and explicit names for actors, objects, conditions, and results.
- Keep a term's meaning consistent. Do not replace a defined term with a
  synonym.
- Do not use contractions. Write the complete words.
- Use a vertical list when one sentence contains many related items.
- Use no more than six sentences in one paragraph.

## Technical terms and structured values

Project terms, product names, code identifiers, record IDs, file paths, YAML
keys, enum values, literal commands, API names, and exact quotations are
technical or structured values. Preserve them exactly. Do not force them into
the controlled vocabulary or rewrite them for style.

When a rule conflicts with a required schema, exact evidence, or an unambiguous
technical term, preserve the required value. Apply the style rules to the
surrounding explanation.

## Canonical projection exceptions

A publication can project exact prose from an older canonical YAML model. Do
not change that prose only to obtain a style-check result. Mark its table as a
canonical model projection. Report each sentence-length exception separately.

Do not treat a Markdown line break or HTML break as a sentence boundary. The
style report must use `APPLIED_WITH_EXCEPTIONS` when exact canonical prose does
not meet a writing rule. Authored reader prose must have no unapproved issue.
