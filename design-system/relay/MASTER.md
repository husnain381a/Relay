# Relay design system

The UI UX Pro Max searches recommended Minimalism/Swiss Style, dense 8–32px spacing, a restrained indigo palette, visible keyboard focus and reduced motion. Search queries and interpretation are recorded in ARCHITECTURE.md. Generic landing-page advice was discarded because this is a communication workspace.

## Identity

Relay is calm, personal and practical: narrow workspace rail, quiet channel navigation, dense conversation canvas, inline message actions and a right thread drawer. No proprietary Slack branding or copied assets. Logo is an original typographic r mark. Lucide icons use a consistent outline style; emoji are reserved for message content/reactions.

## Semantic tokens

CSS in src/app/globals.css is the implementation source of truth. Light: white canvas, #f7f7fb sidebar, #302845 topbar, #24252c text, #6b6e7b muted, #5c4bc4 accent, #e8e9ee separators. Dark: #19191e canvas, #222128 sidebar, #eeeef2 text, #adaebb muted, #b0a1ff accent. Bright welcome surface remains intentionally light; authenticated workspace supports light/dark/system.

## Typography and density

Use installed Segoe UI/system sans for application text (no external-font request); 13–14px message/body text, 19px conversation headings. Serif welcome/onboarding headlines soften the product without affecting conversation density. Secondary labels are smaller and keep contrast. Primary controls have clear names and visible focus; mobile icon hit areas and dense message actions need authenticated-device QA before release.

## Interaction

Semantic button/link/form controls. Radix modal focus management, Escape dismissal, search shortcut Ctrl/Cmd K, shortcuts Ctrl/Cmd /, Enter send, Shift Enter newline. Hover actions also become available on keyboard focus, with a persistent mobile more-actions control. All errors expose recovery or a clear reason. Persisted data drives real counts; skeletons only while loading. No fabricated team or usage data.

## Layout

48px global topbar; 66px workspace rail; 262px channel sidebar; flexible conversation; 380px thread drawer. Below620px the sidebar becomes a dismissible drawer; thread overlays the conversation. Main scroll is virtualized. Composer remains in the conversation flow. Welcome verified at375/768/1440px; authenticated layout still requires real-backend/device QA.

## Motion and accessibility

Only 140–200ms feedback transitions; respect prefers-reduced-motion. Visible focus outline, labeled icon controls, status text alongside colored dots, programmatic form labels and password-manager support. No raw message HTML or externally loaded message-image embeds. Contrast fixes applied to welcome secondary text. Full automated accessibility audit and authenticated screen-reader testing remain release checks.
