# Design language

The web app follows one calm design language. It should feel like a quiet, well-made tool
for working on a resume, never like a template: a cool grey ground, type doing the work,
the document at the centre, a single teal accent. These rules are the contract for every page.

## Foundations

| Token | Use |
| --- | --- |
| `font-display` (Bricolage Grotesque, 600 to 700, tracking -0.02em) | Page titles, the home greeting, section headings in settings and admin |
| `font-sans` (Hanken Grotesk) | Everything else. Body 15.5px at line height 1.7, meta 13px, labels 12.5px |
| `ink` | Text and the one solid call to action per screen (`Button variant="primary"`) |
| `primary` / `brand` | Links, citation marks, focus rings, the active underline, small accents. Never large fills |
| `background` / `ground-2` | Page ground; the sidebar sits on `ground-2` |
| `card` + `shadow-card` + `rounded-card` | Only surfaces that float: menus, dialogs, the document preview |
| `border` | 1px hairlines between list rows and sections |

Widths: the main column `max-w-[780px]`, settings `max-w-[860px]`,
admin `max-w-[1200px]`, gutters `px-4 sm:px-6`. Light and dark mode are a token swap: never
hard-code a colour (`bg-white`, `#fff`, `text-gray-*`).

## Rules

1. **No box inside a box.** A surface never contains another bordered or tinted panel.
   Lists inside a surface are rows separated by hairlines.
2. **Results are not cards.** An analysis, an improved resume or a list of questions is plain
   prose and rows on the page ground, with its actions as quiet icons or text links. Only
   the document preview (the resume itself) is a floating surface.
3. **Forms are not wrapped in cards.** A settings page is a column of sections: heading,
   one line of help, fields, a save button.
4. **Choices are words, not pills.** Tabs and filters are plain words in a row; the active
   one is ink with a 2px underline as wide as the word. Use
   `components/common/underline-tabs.tsx`.
5. **Facts are type.** "PDF · 2 pages · scored 74" is one line of 13px meta text joined by
   middle dots, not chips. Progress steps ("Reading the file", "Scoring") are one muted
   line each, never a coloured panel.
6. **One lit action per screen.** One `primary` button; secondary actions are `outline`,
   `ghost` or a text link. Destructive actions confirm in a dialog that names the thing.
7. **Buttons are 10px-corner bars**, never capsules. Icon-only buttons are round
   (`IconButton`) and always have a label (tooltip and `aria-label`). Hover-only actions
   stay reachable by keyboard: they fade in on `focus-visible` too.
8. **Waiting is calm.** Long AI work shows one muted progress line and a skeleton that matches
   the final layout, never bouncing dots; the page does not jump when it finishes. Cancel is
   always one click away.
9. **Instant UI.** The user's message, renames, pins and deletes are optimistic; skeletons
   match the final layout; never a bare spinner on a blank page. Errors say what happened
   and what to do, with the API `code` mapped in `lib/errors.ts`, and a failed run offers
   "Try again" without losing the input.
10. **No filler.** No "Welcome back!", no icon-in-a-tinted-circle feature grids, no gradient
    blobs, no invented numbers (usage is shown only when it is real). No em dashes in any
    copy.
11. **Accessible by default.** Every interactive element is reachable and labelled; focus
    rings are visible; colour is never the only signal; contrast passes WCAG AA in both
    themes. Results that arrive later are announced politely.

## Patterns

- **Shell**: a left sidebar (the app sections, this month's AI runs, the account menu) that
  collapses on desktop and becomes a sheet on phones; the page fills the rest. Sections are
  listed in `APP_NAV` in `components/app/sidebar.tsx`.
- **Home**: the app name in display type, then the user's resumes as hairline rows; an
  `EmptyState` with one action when there are none.
- **Settings**: tabs as underline words (General, Account); rows of a label, one line of
  help and the control, separated by hairlines.
- **Admin**: a left sidebar of areas, a page header with the title and the primary action,
  then tables with hairline rows, filters as underline tabs plus one search field, and
  detail in a right-side sheet.
- **Empty states**: one sentence of what this is and one action, using `EmptyState`.
- **Dates**: `lib/time.ts` helpers; relative for recent activity, absolute in the audit log.
