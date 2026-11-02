▲ Next.js 16.4.4 (Turbopack)
- Local:         http://localhost:3400
- Network:       http://192.168.0.11:3400
- Environments: .env.local
✓ Ready in 595ms
✓ Running next.config.ts took 38ms
- Experiments (use with caution):
  · serverActions

 GET / 307 in 982ms (next.js: 638ms, application-code: 344ms)
 GET /login 200 in 126ms (next.js: 36ms, application-code: 90ms)
[browser] A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up. This can happen if a SSR-ed Client Component used:

- A server/client branch `if (typeof window !== 'undefined')`.
- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.
- Date formatting in a user's locale which doesn't match the server.
- External changing data without sending a snapshot of it along with the HTML.
- Invalid HTML tag nesting.

It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

https://react.dev/link/hydration-mismatch

  ...
    <HotReload globalError={[...]} webSocket={WebSocket} staticIndicatorState={{pathname:null, ...}}>
      <AppDevOverlayErrorBoundary globalError={[...]}>
        <ReplaySsrOnlyErrors>
        <DevRootHTTPAccessFallbackBoundary>
          <HTTPAccessFallbackBoundary notFound={<NotAllowedRootHTTPFallbackError>}>
            <HTTPAccessFallbackErrorBoundary pathname="/login" notFound={<NotAllowedRootHTTPFallbackError>} ...>
              <RedirectBoundary>
                <RedirectErrorBoundary router={{...}}>
                  <Head headRenderTree={{...}}>
                    <__next_viewport_boundary__>
                    <MetadataWrapper>
                      <__next_metadata_boundary__>
                        <div
                          hidden={true}
-                         bis_skin_checked="1"
                        >
                  <__next_root_layout_boundary__>
                    <SegmentViewNode type="layout" pagePath="layout.tsx">
                      <SegmentTrieNode>
                      <link>
                      <script>
                      <RootLayout>
                        <html lang="zh-Hant-TW">
                          <body
                            className="min-h-dvh bg-stage-950 font-sans text-ink-200 antialiased"
-                           __processed_b0b77cf0-f881-4bed-ac11-af61e2e815f4__="true"
-                           bis_register="W3sibWFzdGVyIjp0cnVlLCJleHRlbnNpb25JZCI6ImVwcGlvY2VtaG1ubGJoanBsY2drb2ZjaWll..."
                          >
                            <ToastProvider>
                              ...
                                <SegmentViewNode type="page" pagePath="(auth)/log...">
                                  <SegmentTrieNode>
                                  <LoginPage>
                                    <main className="flex min-h...">
                                      <div
                                        aria-hidden={true}
                                        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_to..."
-                                       bis_skin_checked="1"
                                      >
                                      <div
                                        className="relative w-full max-w-sm"
-                                       bis_skin_checked="1"
                                      >
                                        <div
                                          className="mb-8 flex flex-col items-center gap-3 text-center"
-                                         bis_skin_checked="1"
                                        >
                                          <div
                                            className="flex size-12 items-center justify-center rounded-xl bg-accent-6..."
-                                           bis_skin_checked="1"
                                          >
                                          <div
                                            className="flex flex-col gap-1"
-                                           bis_skin_checked="1"
                                          >
                                        <div
                                          className="rounded-xl bg-stage-850 p-6 ring-1 ring-stage-700 panel-edge shad..."
-                                         bis_skin_checked="1"
                                        >
                                          <LoginForm>
                                            <form onSubmit={function handleSubmit} noValidate={true} ...>
                                              <Field label="帳號" required={true}>
                                                <div
                                                  className="flex flex-col gap-1.5"
-                                                 bis_skin_checked="1"
                                                >
                                                  <div
                                                    className="flex items-baseline justify-between gap-3"
-                                                   bis_skin_checked="1"
                                                  >
                                                  ...
                                              <Field label="密碼" required={true}>
                                                <div
                                                  className="flex flex-col gap-1.5"
-                                                 bis_skin_checked="1"
                                                >
                                                  <div
                                                    className="flex items-baseline justify-between gap-3"
-                                                   bis_skin_checked="1"
                                                  >
                                                  <div
                                                    className="relative"
-                                                   bis_skin_checked="1"
                                                  >
                                              <Checkbox label="記住登入狀態" description="在這台裝置上保持登入..." checked={true} ...>
                                                <div
                                                  className="flex items-start gap-2.5"
-                                                 bis_skin_checked="1"
                                                >
                                                  <input>
                                                  <div
                                                    className="flex flex-col gap-0.5"
-                                                   bis_skin_checked="1"
                                                  >
                                              ...
                                        ...
                                ...
                              <ToastViewport toasts={[...]} onDismiss={function ToastProvider.useCallback[dismiss]}>
                                <div
                                  aria-live="polite"
                                  aria-atomic="false"
                                  className="pointer-events-none fixed z-[60] flex flex-col gap-2 right-4 bottom-4 lef..."
-                                 bis_skin_checked="1"
                                >
                  ...
 




## Error Type
Console Error

## Error Message
A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up. This can happen if a SSR-ed Client Component used:

- A server/client branch `if (typeof window !== 'undefined')`.
- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.
- Date formatting in a user's locale which doesn't match the server.
- External changing data without sending a snapshot of it along with the HTML.
- Invalid HTML tag nesting.

It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

https://react.dev/link/hydration-mismatch

  ...
    <HotReload globalError={[...]} webSocket={WebSocket} staticIndicatorState={{pathname:null, ...}}>
      <AppDevOverlayErrorBoundary globalError={[...]}>
        <ReplaySsrOnlyErrors>
        <DevRootHTTPAccessFallbackBoundary>
          <HTTPAccessFallbackBoundary notFound={<NotAllowedRootHTTPFallbackError>}>
            <HTTPAccessFallbackErrorBoundary pathname="/login" notFound={<NotAllowedRootHTTPFallbackError>} ...>
              <RedirectBoundary>
                <RedirectErrorBoundary router={{...}}>
                  <Head headRenderTree={{...}}>
                    <__next_viewport_boundary__>
                    <MetadataWrapper>
                      <__next_metadata_boundary__>
                        <div
                          hidden={true}
-                         bis_skin_checked="1"
                        >
                  <__next_root_layout_boundary__>
                    <SegmentViewNode type="layout" pagePath="layout.tsx">
                      <SegmentTrieNode>
                      <link>
                      <script>
                      <RootLayout>
                        <html lang="zh-Hant-TW">
                          <body
                            className="min-h-dvh bg-stage-950 font-sans text-ink-200 antialiased"
-                           __processed_b0b77cf0-f881-4bed-ac11-af61e2e815f4__="true"
-                           bis_register="W3sibWFzdGVyIjp0cnVlLCJleHRlbnNpb25JZCI6ImVwcGlvY2VtaG1ubGJoanBsY2drb2ZjaWll..."
                          >
                            <ToastProvider>
                              ...
                                <SegmentViewNode type="page" pagePath="(auth)/log...">
                                  <SegmentTrieNode>
                                  <LoginPage>
                                    <main className="flex min-h...">
                                      <div
                                        aria-hidden={true}
                                        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_to..."
-                                       bis_skin_checked="1"
                                      >
                                      <div
                                        className="relative w-full max-w-sm"
-                                       bis_skin_checked="1"
                                      >
                                        <div
                                          className="mb-8 flex flex-col items-center gap-3 text-center"
-                                         bis_skin_checked="1"
                                        >
                                          <div
                                            className="flex size-12 items-center justify-center rounded-xl bg-accent-6..."
-                                           bis_skin_checked="1"
                                          >
                                          <div
                                            className="flex flex-col gap-1"
-                                           bis_skin_checked="1"
                                          >
                                        <div
                                          className="rounded-xl bg-stage-850 p-6 ring-1 ring-stage-700 panel-edge shad..."
-                                         bis_skin_checked="1"
                                        >
                                          <LoginForm>
                                            <form onSubmit={function handleSubmit} noValidate={true} ...>
                                              <Field label="帳號" required={true}>
                                                <div
                                                  className="flex flex-col gap-1.5"
-                                                 bis_skin_checked="1"
                                                >
                                                  <div
                                                    className="flex items-baseline justify-between gap-3"
-                                                   bis_skin_checked="1"
                                                  >
                                                  ...
                                              <Field label="密碼" required={true}>
                                                <div
                                                  className="flex flex-col gap-1.5"
-                                                 bis_skin_checked="1"
                                                >
                                                  <div
                                                    className="flex items-baseline justify-between gap-3"
-                                                   bis_skin_checked="1"
                                                  >
                                                  <div
                                                    className="relative"
-                                                   bis_skin_checked="1"
                                                  >
                                              <Checkbox label="記住登入狀態" description="在這台裝置上保持登入..." checked={true} ...>
                                                <div
                                                  className="flex items-start gap-2.5"
-                                                 bis_skin_checked="1"
                                                >
                                                  <input>
                                                  <div
                                                    className="flex flex-col gap-0.5"
-                                                   bis_skin_checked="1"
                                                  >
                                              ...
                                        ...
                                ...
                              <ToastViewport toasts={[...]} onDismiss={function ToastProvider.useCallback[dismiss]}>
                                <div
                                  aria-live="polite"
                                  aria-atomic="false"
                                  className="pointer-events-none fixed z-[60] flex flex-col gap-2 right-4 bottom-4 lef..."
-                                 bis_skin_checked="1"
                                >
                  ...



    at div (<anonymous>:null:null)

Next.js version: 16.4.4 (Turbopack)
