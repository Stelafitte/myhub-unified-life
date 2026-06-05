import { describe, it, expect, beforeEach } from "vitest";
import {
  detectInboxControl,
  emitInboxControl,
  subscribeInboxControl,
  setCurrentInboxSelection,
  getCurrentInboxSelection,
  hasInboxControlListeners,
  type InboxControlEvent,
} from "./inbox-control-bus";

describe("detectInboxControl", () => {
  it("detects 'suivant' variants", () => {
    expect(detectInboxControl("suivant")?.type).toBe("next");
    expect(detectInboxControl("passe au suivant")?.type).toBe("next");
    expect(detectInboxControl("mail suivant")?.type).toBe("next");
    expect(detectInboxControl("prochain mail s'il te plait")?.type).toBe("next");
  });

  it("detects 'précédent' variants", () => {
    expect(detectInboxControl("précédent")?.type).toBe("prev");
    expect(detectInboxControl("mail avant")?.type).toBe("prev");
    expect(detectInboxControl("mail precedent")?.type).toBe("prev");
  });

  it("detects 'premier' / 'dernier'", () => {
    expect(detectInboxControl("premier")?.type).toBe("first");
    expect(detectInboxControl("va au premier mail")?.type).toBe("first");
    expect(detectInboxControl("dernier")?.type).toBe("last");
    expect(detectInboxControl("dernier email")?.type).toBe("last");
  });

  it("detects 'ferme' / 'quitte' / 'retour'", () => {
    expect(detectInboxControl("ferme")?.type).toBe("close");
    expect(detectInboxControl("quitter")?.type).toBe("close");
    expect(detectInboxControl("retour à la liste")?.type).toBe("close");
  });

  it("returns null when no command", () => {
    expect(detectInboxControl("bonjour")).toBeNull();
    expect(detectInboxControl("envoie un mail à Paul")).toBeNull();
    expect(detectInboxControl("")).toBeNull();
  });
});

describe("bus subscribe/emit", () => {
  beforeEach(() => {
    // clear listeners by re-subscribing/unsubscribing isn't possible; we just ensure
    // each test cleans up its own listener.
  });

  it("emits to subscribers and unsubscribes correctly", () => {
    const received: InboxControlEvent[] = [];
    const unsub = subscribeInboxControl((e) => received.push(e));
    expect(hasInboxControlListeners()).toBe(true);

    emitInboxControl({ type: "next" });
    emitInboxControl({ type: "delete-current" });
    expect(received.map((e) => e.type)).toEqual(["next", "delete-current"]);

    unsub();
    emitInboxControl({ type: "prev" });
    expect(received).toHaveLength(2);
  });

  it("isolates listener errors", () => {
    const ok: InboxControlEvent[] = [];
    const unsub1 = subscribeInboxControl(() => { throw new Error("boom"); });
    const unsub2 = subscribeInboxControl((e) => ok.push(e));
    expect(() => emitInboxControl({ type: "next" })).not.toThrow();
    expect(ok).toHaveLength(1);
    unsub1();
    unsub2();
  });
});

describe("current selection", () => {
  it("stores and reads the selected email id", () => {
    setCurrentInboxSelection(null);
    expect(getCurrentInboxSelection()).toBeNull();
    setCurrentInboxSelection("abc-123");
    expect(getCurrentInboxSelection()).toBe("abc-123");
    setCurrentInboxSelection(null);
    expect(getCurrentInboxSelection()).toBeNull();
  });
});

// Réplique des regex de VoiceActionConfirm pour vérifier la robustesse des
// commandes de confirmation/annulation vocales.
const CONFIRM_RE = /\b(oui|confirme|valide|ok|d'accord|exécute|execute|vas[- ]y|go)\b/;
const CANCEL_RE = /\b(non|annule|stop|laisse|arrête|arrete)\b/;

describe("voice confirmation phrases", () => {
  it("matches confirm phrases", () => {
    for (const t of ["oui", "ok", "confirme", "valide", "d'accord", "exécute", "execute", "vas-y", "vas y", "go"]) {
      expect(CONFIRM_RE.test(t)).toBe(true);
    }
  });
  it("matches cancel phrases", () => {
    for (const t of ["non", "annule", "stop", "laisse", "arrête", "arrete"]) {
      expect(CANCEL_RE.test(t)).toBe(true);
    }
  });
  it("does not confuse neutral speech", () => {
    expect(CONFIRM_RE.test("je ne sais pas")).toBe(false);
    expect(CANCEL_RE.test("super merci")).toBe(false);
  });
});
