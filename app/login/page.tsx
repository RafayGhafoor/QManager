import React from "react";

import LoginComponent from "@/components/auth/login-component";
import { LoginLanguagePicker } from "@/components/auth/login-language-picker";
import { ModeToggle } from "@/components/public/mode-toggle";

// =============================================================================
// /login/ — the pre-auth shell
// =============================================================================
// A single card centred on an empty canvas. The page owns nothing but the
// canvas and the corner chrome; every state lives in LoginComponent.
//
// The corner cluster pairs LoginLanguagePicker with ModeToggle at icon-sm, one
// optical rhythm. The pre-auth surface is where an explicit theme choice
// matters most: it is the one screen a visitor sees before any preference of
// theirs has been stored. No footer: the card is the page.
// =============================================================================

const LoginPage = () => {
  return (
    <div className="bg-background relative grid min-h-svh place-items-center p-4 sm:p-7">
      <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5">
        <LoginLanguagePicker />
        {/* Here the trigger floats on the page background rather than sitting
            on a card, so it takes `surface` plus the whisper elevation to lift
            off it — the Overview's copy sits ON the card and keeps the default
            `surface-container` instead. `--shadow-whisper` self-neutralises in
            dark mode, which is the light-only behaviour the comp draws. */}
        <ModeToggle
          size="icon-sm"
          className="bg-surface shadow-[var(--shadow-whisper)] hover:bg-surface-container"
        />
      </div>
      {/* The card's container-query context, and the element that owns its
          width cap. The card queries THIS box rather than the viewport, so its
          gutter step is a fact about how much room the card actually got --
          which is the whole point of a container query and the reason the cap
          lives out here instead of on the card itself.

          The arithmetic, because it is easy to get wrong: at a 375px viewport
          the page gutter is 2 x 16px, so this box resolves to 343px, below the
          25rem/400px cliff, and the card takes its 24px step. The box only
          reaches its 404px cap at a >=436px viewport, where the 34px step
          takes over. */}
      <div className="@container/login w-full max-w-[404px]">
        <LoginComponent />
      </div>
    </div>
  );
};

export default LoginPage;
