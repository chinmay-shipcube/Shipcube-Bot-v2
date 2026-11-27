/*
 * ShipCube Bot (test version)
 * On ShipHero "Bulk Ship" batch pages it:
 *   1. copies each item's "Ordered" amount into the Box 1 quantity field
 *   2. picks the box size from the dropdown using the rules below
 * It NEVER clicks "Generate labels".
 */
(() => {
  "use strict";

  // ===================== RULES (edit here) =====================
  // Total units in the box  ->  box name as shown in the ShipHero dropdown
  // Box rules PER CUSTOMER (matched against the customer name in the page title, e.g. "… • Kitsch").
  // Customers not listed here: the bot leaves ShipHero's box choice alone.
  const CUSTOMER_BOX_RULES = {
    kitsch: [
      { maxUnits: 3,        box: "6x6x6 Box" },   // 1-3 units
      { maxUnits: 11,       box: "10x9x4" },      // 4-11 units (matched by size)
      { maxUnits: Infinity, box: "12x9x4 Box" },  // 12+ units
    ],
  };
  let BOX_RULES = CUSTOMER_BOX_RULES.kitsch;   // replaced at run time by the editable rules (⚙ Settings)
  const PAGE_MATCH = /\/bulk-ship\//;                       // pages where the bot works
  const SECTION_TITLE = "decide how each individual order will be packed";
  // =============================================================

  const VERSION = "2.6.0";
  const LS_AUTO = "shipcubeBot.auto";
  const LS_ROWS = "shipcubeBot.rows";
  const ROW_CHOICES = ["auto", "off", "25", "50", "75", "100", "250", "500", "1000"];
  // hidden background tabs: Chrome slows their timers, so they wait with the bot's own clock (the background)
  const sleep = (ms) => (document.hidden && ms >= 100 && typeof rtCall === "function"
    ? rtCall({ type: "clock", ms }, ms + 5000).then((r) => (r && r.ok ? null : new Promise((res) => setTimeout(res, ms))))
    : new Promise((r) => setTimeout(r, ms)));
  function pageKey() {
    try {
      const u = new URL(location.href);
      return u.pathname + "|" + (u.searchParams.get("products") || "") + "|" + (u.searchParams.get("customer") || "");
    } catch { return location.pathname; }
  }
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const own = (el) => norm(el.innerText || el.textContent || "");
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const center = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r };
  };
  const dims = (s) => {
    const m = (s || "").match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
    return m ? `${+m[1]}x${+m[2]}x${+m[3]}` : null;
  };
  const leafs = (root) =>
    [...root.querySelectorAll("*")].filter((el) => visible(el) && ![...el.children].some((c) => visible(c) && own(c)));

  // ---------------- panel ----------------
  let panel, logEl, autoBox;
  function buildPanel() {
    if (panel) return;
    panel = document.createElement("div");
    panel.id = "shipcube-bot";
    panel.innerHTML = `
      <style>
        #shipcube-bot:not(.scb-show){display:none!important}
        #shipcube-bot{--navy:#011842;--navy2:#0A2A5E;--gold:#FCBE08;--gold2:#E5AB00;--ink:#0F172A;--mute:#64748B;--line:#E2E8F0;--soft:#F4F6FA;
          position:fixed;right:18px;bottom:18px;z-index:2147483647;width:340px;
          font:13px "Segoe UI",system-ui,sans-serif;background:#fff;color:var(--ink);border-radius:14px;
          box-shadow:0 12px 32px rgba(1,24,66,.28);border:1px solid var(--line);overflow:hidden}
        #shipcube-bot .hd{display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--navy);color:#fff;font-weight:700;letter-spacing:.2px}
        #shipcube-bot .hd img{width:30px;height:30px;border-radius:7px}
        #shipcube-bot .hd .ttl{display:flex;flex-direction:column;line-height:1.15}
        #shipcube-bot .hd .ttl small{font-weight:400;color:var(--gold);font-size:11px}
        #shipcube-bot .hd .gear{margin-left:auto;cursor:pointer;color:var(--gold);font-weight:600}
        #shipcube-bot .hd .x{margin-left:10px;cursor:pointer;opacity:.8}
        #shipcube-bot .steps{display:flex;flex-wrap:wrap;gap:4px;padding:8px 12px;background:var(--navy2)}
        #shipcube-bot .st{font-size:11px;padding:2px 7px;border-radius:999px;background:rgba(255,255,255,.12);color:#CBD5E1}
        #shipcube-bot .st.done{background:var(--gold);color:var(--navy);font-weight:700}
        #shipcube-bot .st.wait{background:rgba(252,190,8,.18);color:var(--gold)}
        #shipcube-bot .st.bad{background:#FEE2E2;color:#B91C1C}
        #shipcube-bot .st.skip{opacity:.55}
        #shipcube-bot .bd{padding:10px 12px}
        #shipcube-bot .cust{font-size:12px;color:var(--mute);margin-bottom:6px}
        #shipcube-bot .cust b{color:var(--navy)}
        #shipcube-bot .log{max-height:170px;overflow:auto;font:12px Consolas,monospace;background:var(--soft);border-radius:8px;padding:8px;margin:8px 0;white-space:pre-wrap;border:1px solid var(--line)}
        #shipcube-bot .ok{color:#047857}#shipcube-bot .warn{color:#B45309}#shipcube-bot .bad{color:#DC2626}#shipcube-bot .muted{color:var(--mute)}
        #shipcube-bot button{font:600 12.5px "Segoe UI",sans-serif;border-radius:8px;padding:6px 11px;cursor:pointer;border:1px solid var(--line);background:#fff;color:var(--navy)}
        #shipcube-bot button:hover{border-color:var(--navy)}
        #shipcube-bot button.p{background:var(--gold);color:var(--navy);border-color:var(--gold)}
        #shipcube-bot button.p:hover{background:var(--gold2)}
        #shipcube-bot .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        #shipcube-bot label{display:flex;gap:6px;align-items:center;cursor:pointer}
        #shipcube-bot input[type=checkbox]{accent-color:var(--navy)}
        #shipcube-bot.min .bd,#shipcube-bot.min .steps{display:none}
        #shipcube-bot input:not([type=checkbox]),#shipcube-bot textarea,#shipcube-bot select{font:12px "Segoe UI",sans-serif;padding:4px 6px;border:1px solid var(--line);border-radius:6px;box-sizing:border-box}
        #shipcube-bot .scb-settings{max-height:420px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:8px;background:var(--soft)}
        #shipcube-bot .scb-co{border:1px solid var(--line);border-radius:8px;padding:8px;margin:6px 0;background:#fff;border-left:3px solid var(--gold)}
        #shipcube-bot .foot{font-size:11px;color:var(--mute);text-align:center}
        #shipcube-bot .bd{max-height:calc(100vh - 150px);overflow:auto}
        #shipcube-bot .cd{display:flex;align-items:center;gap:8px;justify-content:space-between;background:var(--gold);color:var(--navy);font-weight:700;border-radius:8px;padding:6px 8px;margin-bottom:8px}
        #shipcube-bot .cd button{background:var(--navy);color:#fff;border-color:var(--navy)}
        #shipcube-bot .scb-settings.side{position:fixed;bottom:18px;width:440px;max-height:calc(100vh - 36px);margin:0;box-shadow:0 12px 32px rgba(1,24,66,.28);background:#fff;z-index:2147483647;box-sizing:border-box}
        #shipcube-bot .hd .x{flex:none;padding:0 4px;font-size:15px;line-height:1}
        #shipcube-bot .hd{padding-right:14px}
        #shipcube-bot .scb-settings .tabs button{padding:4px 9px;font-size:12px}
        #shipcube-bot .scb-settings .rule{display:flex;gap:6px;align-items:center;flex-wrap:nowrap;margin:3px 0}
        #shipcube-bot .scb-settings .rule .del{cursor:pointer;color:#94A3B8;padding:0 4px}
        #shipcube-bot .scb-settings .rule .del:hover{color:#DC2626}
      </style>
      <div class="hd"><img alt="ShipCube" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAS3ElEQVR42u1aeZReRZX/3Vv13vu+r/fsaQiBkARwAgRCBNlCWETmsDPiACJzBhUYEB0ElAFl3AYQHECBYZmIRwUFEVQUBhmHfYdEmjUrgSQk6STd6e5vee9V1b3zx9dpmqSTdEbHOQ7W6dPnLV/Vq1v31r2/+6tLNO5QbL6pKhERkaoCIKKB54Nvh3yy5WHrI9dvN+q1YSgGtjCaAgqA8Wfe7JZfD3NF/yRNBxvFwPVwBahb0eDOA7reVPubdh9sYJszv02Gem/SAIgGBBAiHrDD/+8mtLkVHXwrIoOfb2p1A4MM6Qk232TwgAM/HvAo9es/ew18YLxQXWsbKX1I37+Rl9iqWW5TG2w/HwwNbLzkLCQxqwsMUgLACiGQWqPiWd7fi+qhlDZETe2PrLSRa99y8NlyjLfbpkFhwCsTWCEKUP+sVIkCSKjfLw98jAYmqtAN8vRLQtDNCvHH0sBGzYjVyAWx7MAKsECNYVIECiBrRRhQqKB/ugwFjECJjUGAiID6NaNg7Y9QQkQbVuSPJMBG3rfeAgdNtcB9wUKIWIORKM09kthIrNUstg4kYIMBayGFOEaSlyVK2shkQVIIQAjEBJAygb1zbNRwrMpBZfhwZvgaUCID13PxqT0n7FtB1cEqXGQSXbSs9XNzGnqoesOZ6/ab6lIfLOvgb3rhYnPDsx34/E3lf7v5qhnTpqTeM3PdlIKXiKO3ly8//ayvpXkAb7Cy4fqlLcJpogCNwblC4Qsl7X3m5p7dp3bC1WAyhCagCmmf9snt1pTdwrtXNjd111e3LjLIAwLEqGaIxx13setpPOHR+24c8lvX3HzXRf94tR051mvZCKlaJf3DBej/J2qZ0xDCwbusO2pmXvEAxLq4mKTzlhfufWqE+MKx+3Tus2uWObH1biDPXtU0kZ44q7LjqPKideP2OMNf9e1rzv/s39TSchwVN2wGVVG29phTLnjw/ifNiFb1XsHD0cPWBICFCSQJhRBsxmpDLSD3iCyEIDVoATGZojchzlNAAJYNKEbBDtSIvvTvjn/z9otSGFxzX+EbP5j68gv3TBzfKsrM/YFIRYmw+N3Ogw79ZOc61gJDc+jW97Shxp22KEDQnMjXwFWIh5JN0jgxkQlUcJxEUcKJyb0gaDCFYAqe40Cx49jbWGwSEuvjyB13kD949658fWWfPVt/+UjtyY7aqScdpqLE78H14N2ottYx40ffd88DSUNJVOsKUFVmHnAqmwDKzWuAGVK2R81cfvFpFRMqBIIhQ0QqHmoEwsyskQ+5GAWYtD64itR3fZ6oFVvkhl0n9RX9ehdMXIjnLRq397nVe37245M+dkiaZcaYOvb3QYOkxWLzp875yp0/eMCOGRWcHxBg00R0aAEGJy5sEHr9Nf/Q88Wz30WXIs4gDGGYFDAAQQUaQABFgOJ9VksgRchRFQTWPDhEJmLvqklL0/k3tv78iX0Wv35XIRrCDQZgv0M/8+K8N02pICLbtgfel3mRskQT21aceDCKkfckJJEQlLPYJWpyJUBsf0xlD7GgoIASESH3mN6OE/dfI6YaC4OVwIAIo8+17Xdh84gxh+++2yjn62ta9zgWosVE572x7Pnn51McbRX52S27fuWwZM121/ykCuQIMYhBBA7gAJeABcYDjMBQ6X9FBAhIIRZ+3c//ZcTxM32o5spkyEFiFSFDRS2EXLNcXe7rS8dQaFBVCJwLUPmfROKNkZM6EwWOS2oKQLBilEKWF+FTFAhqERLAURGxLWa1DJJA677fIlBSKhaLvSQZqypIlCT4ZEzp8ht4Zd/EpU//a6lYGHJaB/z12RqUNwHP2xyJBYZIRR1cAnLB1DRt2rX93XOO7SsZ76BEkUvptgeaXn239ei9Oo+fnTmXW1aCyZSntsvsyT1pqglZFslF4iTpWFC65qeFW24/r1QsVKu1KIr6tz5cCK6QNF/yjeuffvj5aPw479KtoqOtJjQGFEACyQBjtNGncuysyvnnOKyuoqRwFbTtsDZNXrlx7QWnFGYf3o1KH6iOOBkZwUtRm1CpVtnEJmjcePF1yUEHHvP3Jx7hnS8kCRHVJ5l7LSTFl15ZcMP37uXRrUFSDCOW2c1Rce9BdmWAtZ8GC6bQ+ItHmkc21dqihipCTGOqteiuR6pUGnnNHavnr2j12kQCJijEgvKYCuIO/1Bz+6iVNine/WTLw68lLz99niqYiJl0g7NXqA/6hUuuLNeCbUtCcFtNEobwQpsI8L4OBgzKfFqE9AACEdgIXmERNYxwfRlCBgQQQetSGzBQqf3tsWvu/PKa9X1j/+oz2cmnX3bdP5+bZnkUR7QhOfAhRNbedOvd555/hR03WlMnIGye7BgQwG4LoaJBiNXYxCMqkkTQGCwKiDjNPTcwU4PqhvhKhJBBrdjqx/a0VGr5+g1eee9//vynMpcTvLj64pP3khTixUvfvfzKOdw4UlzQDThsq5m03RqbNzi3IpCKxlDAe6UcStapMMTkaoKCNUR17wsoCRHFSLOLTnVnfEJe7ijc/pC9+yffbG1rAgDEA5+JEgC48KvXrl3TEzW3uOCJzDARtd0SEamGOagCxIAHACaFh1gbrFgnnEOZwNZHLMbVY58SSIUYRgW+1OhcVvzWnNqvnijZ4k5PzX3x2Wee9ZZYSEgBUlVrzcpVy3710BPc2ize1VEPYEDy3vIpDVBdw8BCBAUsYibJnVibKKWigdSSEaFAIFJWUahNKMmNF3IUiJiMGGFS8vBehWCMlHO4gKaEjZf1FShgAySCCpj68wcbxU0tnrwNEhSqMMTgEDgnKbJKUKeINlXL5sEcs1b7QEhKhaxcBhWpWNRqBaLcYEUUtQAbcxxJtReGOSlJVkYAYKAeHEelJkEWqj6K1SZUK9eQtNoEPk0jsVQowCP3PVHcpOgLKVQtggEUBWJLkuXwBgKwg40osUPa1JAmpMxxqPTt8+EpX7nknD0m77hw0ZJLr5jzwrNv3HrzpaPGjjr59MvGjmv90Q3/9MhTHVdcN+cXP/t25+r151589c3XfXnKTturjdZ3d932w18/+F8dUPnEoavPOcGPbEg73mi6ZI5UbfnHF5m5K+jSG5uPOji98JTs67f1UKH4lU/05lm5wZdeeDe+4p5ibzX6zgW9u4zttd5Yq4vXN5373ZZKXmIWfX+SYIdM58W7trbSnXOumjKhfe68hUfMPnB8+w77zjr5wH2nT915AsE3lqLDDppR7quJ1I45cv8lb60Syg47aMakSTssWbFi9v7Tjz5y1p6Hnm27H//+JQ7V8vylDaeeVOkFX/F9e+SH09LrmVbG7DBizeyDe279aSlu4NkHda5ZGvvgDzyiOrLZnXd18fhpYbsJPYtWjm6MXB6xgR8yKg/BzBGz1mq77rbzlAntP7vvP2bsfcIdv3p42i47jBs7pnNduVKtRGxYEYJUKhmQ9PTUevtqGqJa7t7u7Jy8x5FnXXRVZM1+MyZP22ldqcl98fYR+3w+Xrawcvj0dITtLfdmWS0Hh8zHoeyrMFnuQt78pVtG7PHppuVLZNbUCjegy/cuXljc/+zS5E+OOvrLDeVQJFLdJEezGPpowYTMARgzeiRKpa9+65YffP+eztVdpdgY0mo56+urGcNKCuWYLQyUmIyxNtbQ+tbCFaoaxVHda/X0WXEtz72lhShypYDIG1gYMMQYMuotjDFUdqW1K/LuMtqSBBwSMWJoTbURrpmKQhjaCw0hgIpyQ/zK6wuf75g/68CZV1957kWXXL/ktU5TAqkyokMO+NCYUW11uF1PyglQVQNYn6PSvV37KCLKMs8qBLJKZEtnXz8yKycjx4VIy/o+9s4QEbS2x4Te6Lieqe2Nd/wuKqccjDZa+uhenVnw85eb1eVWQlAMQwMKGGPSSvms8y+/9yffu/BzZ+yw/cRPf+Gb1WrqJBSLySO/uW0QZ6GgevrGeZ63tYx74sk7p++xqwBPPt8xe2IMDhUbVGpp3lb1OjKQMoQdlAeIUiIgrV12WoKmUlhTuefxJIQ278sTxi1/6DtjUKye9CVz7yOJaYiD6EaM29DsdAhqSiN//+zCw48+67m5808+4ZArLj87VGtRHOep+8KXrr38mzdvGKX+RwQowUbx6NFtv3/tjTPPuWzxi0taklY4afMFRFrNK5oFjxhwVgqgaAAtiigKxWvvK575ldJ6wuVnRi0ta4Sls7v1wmtK510try5ugIlkKDRhNwMfxJAbO2XnFcs6jzvl0kcfuPrTpx135Xf+PWTOBXf9d3+43cTxX7vsbEMM1GlQVRUb8erOtTMOPLWSOoilYpOj1TDeKRnVS07rsuA7f9uXI/YMY30/2CFWNaBk7oLij39JRx9RPHZ6mNicsM/7XHTdrxsDipQUOGbVsKkj2kQD5JmtlrOZe0555fE5F3zu46sXzP3PR19Mkmj02LHeC1tTGt3W2NZQz9sB9QQSQGCUlElQpLi50NKimiqsSlzT9aGcnnFQ32c/2leIAgeGqYRq2YlqiAXqjQKkHAAf5YnmZGECE3wWAIRYq5kiAxjgesq+eQ1oBFIY6al2t7U1nXDUrN/P7Zi133QfdPWaNWwFihAkBFFRKEEthKAMNapQVSZVVR88EK/sZjI4Yd8+ET++KXthRdPqNdxVtXtvn378iJXHz1Qyycq1NGmnVJ37yG5uRJTOml5d1te4orcaO2kdkZ7z0Qo4rYXCXU831Dw25XntEGcAErjU8FrHklt/dP9nTz/mgftuAXDldT96d8nappY2NpYgIBATRUyoUsFoQsR5VIhsHNchmohwkR+d1/C7R/JTjqqdcpRUcnvTHF29bvS1v+n99pl091UA0/0Pmpc7Rs3YLSe36tzjupCY7p6Gr99R6O0taKFvZHvlpotzlGrLOrf75TNUq7u7YWAhZbUcAK3O3n9G+8Tt3lmy7NGnOzi2M/faucEWnpq7IIqjA/beafna8oI3l83cd+dalna8vGLm9Ilk+PmOBd5bkDL5oKWmZN1h08ptjfalhabjrZJJWiTv/chu5V12pFVdlcfntVXRNHGU37V9fR7yDMUVq9zSd9sKCe25c6WxVPMOzFkaWl9a1OQCDReNkiKxkRfvKilEwFHc3EySZZVeaGIaoIGk7NFkLAo+TWFgTcHnVQQ1zQZUUBGikIhNxYqrwuewI5IiOe2y3JJXBVIGEyVJROR8qnkLOAXFiPJiRCo2zTxCHVQDhhGVSZNhoVFVNdaIyyAEQ+p8FFuXOTIlmxALMgmxhXOexItaRGTBokRAZE0eUnEERNAMGiDORiWbFIOISg4yPs0jsLCSZRGSkJtSwQSoCFmTuxpyBUcgB2IgMRSCFy5EOsyEhtmEam3qLpMaS0kS2w9Nm/z0k3NHjW7xzj/zWMeoccn4NrN0QeWgQ/afNGnc62+8req6e9Ml8+fvMm3kwgV948ZtP6G9ua8nHTu2ua9aHj9+vCo9+OvHR40vFg2WvhMOP3wvCaa1tamWpYsWL911yk733/e7MZNaCoaXLXdHHDZjdOuYt995Z7ddp6zr6lu1eoUP1NrS/PBvn+KmZt2EaRwKjTLB5TtO3G6PaZNq1XTCDi1WZkzfazcfas89Nr+U0OjmfGktnTF9j+Y2rwHbjxnxyNz5izvmjhrZON9lI1tGzz5k2vp1lT2n79LdvbZYbHzp5TdDLTQ1SEuUL63yaR8/csHba7uWrdpxr6nTpk8+YPe9H/rt8wVbaSha0vgj++0+efudS42Hvfpax5iRLTNn7ESm2N4+9rEn5rqheNIh6HUFYKi7a+2E7duffnbe2nXrslSffubFN5e8taorJa2ZmLvWGyHt6+tZuGhFQ2PD40+9EIQaGm25L1m3bv3YcW0rlq1+8aV5Cxcs6+5KV3X2vrOiq1AgL9qdNqxcvuTtlV2966vlauWVN5fMe/GlrgqJrykl3eVIOH/8sefemL+ou5y99fbaea/Of2f5qhde6uitSq1aZWMGs+2b38QEdV7THEkEcQgeJoJhMkksxrNCNfgUosxF8VVOCsZYlZxgA4tUq+AECBAGckQx24hYITmihlBL4YQiVi8QBjlbLDJDFUImZGWiSJ0DGRCDAXEgIIqJbZ1AGmDbh2anB2nH1FGsigeYiIPkUAIxVNkwgaBEln2eg4jA0KCkhi1AqqKqbIiIQwj1/J0YTBb9IIqhCoYEX6ej+sOLDhQ3SR1mEVF9hG2gVVTVq6d6nRGxikAF4P5DLRpUZeN9/aGiHipJVAbOIyAMhIEqNxUIuf6jMfX9xwH1w4T+wxFVQCQMVNJsqHyiP6BaZSsUMW1ygWH/njbqpds21Gbo9WFWlgwuPBrO882NObi6RVUxFLf5Qa0X2nL50HCWfPCrwedXmyv629Y6yT+FBv6QCqe/mNA2ruUWqhw3MrNtVcvmrPcDpoFhrtNGhaL/qxvpL3Wj/9ftvwFdwL9VDMWj3AAAAABJRU5ErkJggg=="><div class="ttl">ShipCube Bot<small>v${VERSION} · ShipHero assistant</small></div><span data-a="settings" class="gear" title="Settings">⚙ Settings</span><span class="x" title="minimize">▁</span></div>
      <div class="steps">${STEP_KEYS.map(([k, t]) => `<span class="st" data-step="${k}">${t}</span>`).join("")}</div>
      <div class="bd">
        <div class="cust" data-a="cust">Customer: —</div>
        <div class="row"><button class="p" data-a="run">Fill box now</button>
          <label><input type="checkbox" data-a="auto"> Auto</label>
          <button data-a="debug" title="Copies page info so you can send it to Claude">Copy debug info</button></div>
        <div class="row" style="margin-top:8px"><label>Rows per page
          <select data-a="rows" style="font:13px 'Segoe UI';padding:4px 6px;border-radius:6px;border:1px solid #E5E7EB">
            ${ROW_CHOICES.map((v) => `<option value="${v}">${v === "off" ? "don't change" : v === "auto" ? "auto (by order count)" : v}</option>`).join("")}
          </select></label>
          <button data-a="rowsnow" title="Set rows per page now">Set</button></div>
        <div class="row" style="margin-top:6px"><label title="Choose the best picking location for every item (ops team rules)"><input type="checkbox" data-a="pickloc"> Pick locations</label>
          <button data-a="picknow">Pick now</button></div>
        <div class="row" style="margin-top:6px"><label title="Tick the select-all box at the end"><input type="checkbox" data-a="selall"> Select all orders</label>
          <label title="Only select all after someone chooses an Order status"><input type="checkbox" data-a="waitstatus"> after Order status</label>
          <button data-a="selnow">Select now</button></div>
        <div class="row" style="margin-top:6px"><label title="After select-all, click Generate labels automatically (5-second countdown, can be cancelled)"><input type="checkbox" data-a="autogen"> Auto-generate labels</label>
          <label title="On the Batch screen: after the batch number is copied and saved to the sheet, close the tab"><input type="checkbox" data-a="autoclose"> Close tab after batch</label></div>
        <div class="row" style="margin-top:6px"><label title="Count the orders per Order status, pick the biggest status, and after its batch is made reopen the page for the next one until every order is done"><input type="checkbox" data-a="rounds"> Every order status (biggest first)</label></div>
        <div class="row" style="margin-top:6px"><label title="On the Batch screen: download the label + packing-slip PDFs as <batch>-l.pdf / <batch>-p.pdf into the Label Merger Inbox"><input type="checkbox" data-a="autodl"> Auto-download PDFs</label></div>
        <div class="row" style="margin-top:8px"><button class="p" data-a="qstart" title="Pass 1: open every batch link in the sheet that isn't done yet and generate its labels. Tabs close as soon as the batch is saved.">▶ 1. Generate all</button><button class="p" data-a="qdl" title="Pass 2: open every batch already generated (no PDF link yet), download labels + packing slip, close the tab.">▶ 2. Download all</button><button data-a="qstop">■ Stop</button></div>
        <div data-a="qstat" class="cd" style="display:none;margin-top:6px"></div>
        <div class="row" style="margin-top:8px;justify-content:space-between">
          <span>Top order: <b data-a="topid" style="font-family:Consolas,monospace">—</b></span>
          <span class="row"><label title="Copy the top order ID automatically"><input type="checkbox" data-a="autocopy"> Auto-copy</label>
          <label title="Include the # sign"><input type="checkbox" data-a="hash"> #</label>
          <button data-a="copyid">Copy</button></span></div>
        <div class="log"></div>
        <div class="foot">Never clicks “Generate labels” — you stay in control.</div>
      </div>`;
    document.body.appendChild(panel);
    logEl = panel.querySelector(".log");
    autoBox = panel.querySelector('[data-a="auto"]');
    autoBox.checked = getAuto();
    autoBox.onchange = () => { try { localStorage.setItem(LS_AUTO, autoBox.checked ? "1" : "0"); } catch {} };
    panel.querySelector('[data-a="run"]').onclick = () => run(true);
    panel.querySelector('[data-a="debug"]').onclick = copyDebug;
    const rowsSel = panel.querySelector('[data-a="rows"]');
    rowsSel.value = getRows();
    rowsSel.onchange = () => { try { localStorage.setItem(LS_ROWS, rowsSel.value); } catch {} ; setRowsPerPage(true); };
    panel.querySelector('[data-a="rowsnow"]').onclick = () => setRowsPerPage(true);
    const ac = panel.querySelector('[data-a="autocopy"]'), hs = panel.querySelector('[data-a="hash"]');
    ac.checked = getFlag(LS_AUTOCOPY, true); hs.checked = getFlag(LS_HASH, true);
    ac.onchange = () => setFlag(LS_AUTOCOPY, ac.checked);
    hs.onchange = () => { setFlag(LS_HASH, hs.checked); lastCopied = null; checkTopOrder(true); };
    const pl = panel.querySelector('[data-a="pickloc"]'), ws = panel.querySelector('[data-a="waitstatus"]');
    pl.checked = getFlag(LS_PICKLOC, true); ws.checked = getFlag(LS_WAITSTATUS, true);
    pl.onchange = () => setFlag(LS_PICKLOC, pl.checked);
    ws.onchange = () => setFlag(LS_WAITSTATUS, ws.checked);
    panel.querySelector('[data-a="picknow"]').onclick = () => { pickDoneUrl = null; pickLocations(true); };
    const ag = panel.querySelector('[data-a="autogen"]'), ac2 = panel.querySelector('[data-a="autoclose"]');
    ag.checked = getFlag(LS_AUTOGEN, false); ac2.checked = getFlag(LS_AUTOCLOSE, false);
    ag.onchange = () => { setFlag(LS_AUTOGEN, ag.checked); log(ag.checked ? "Auto-generate ON — the bot will click Generate labels after select-all (5s countdown)." : "Auto-generate OFF", ag.checked ? "warn" : ""); };
    ac2.onchange = () => setFlag(LS_AUTOCLOSE, ac2.checked);
    const rnd = panel.querySelector('[data-a="rounds"]'); rnd.checked = getFlag(LS_ROUNDS, true); rnd.onchange = () => setFlag(LS_ROUNDS, rnd.checked);
    panel.querySelector('[data-a="qstart"]').onclick = () => startQueue("gen");
    panel.querySelector('[data-a="qdl"]').onclick = () => startQueue("dl");
    panel.querySelector('[data-a="qstop"]').onclick = async () => { showQueue(await qCall({ op: "stop" })); log("Sheet queue stopped — no more links will be opened.", "warn"); };
    setTimeout(async () => showQueue(await qCall({ op: "status" })), 1200);
    setInterval(async () => { if (!document.hidden) showQueue(await qCall({ op: "status" })); }, 6000);
    const adl = panel.querySelector('[data-a="autodl"]'); adl.checked = getFlag(LS_AUTODL, true); adl.onchange = () => setFlag(LS_AUTODL, adl.checked);
    const sa = panel.querySelector('[data-a="selall"]');
    sa.checked = getFlag(LS_SELALL, true);
    sa.onchange = () => setFlag(LS_SELALL, sa.checked);
    panel.querySelector('[data-a="selnow"]').onclick = async () => { await selectAllOrders(true); const n = selectedCount(findHeaderCheckbox()); if (n) await recordSelection(n); };
    panel.querySelector('[data-a="copyid"]').onclick = () => { lastCopied = null; checkTopOrder(true); };
    panel.querySelector('[data-a="settings"]').onclick = openSettings;
    panel.querySelector(".x").onclick = () => { panel.classList.remove("scb-show"); const ov = panel.querySelector(".scb-settings"); if (ov) ov.remove(); };
  }
  const STEP_KEYS = [["rows", "Rows"], ["loc", "Locations"], ["box", "Box"], ["status", "Order status"], ["sel", "Select all"], ["sheet", "Sheet"], ["gen", "Generate"], ["batch", "Batch"], ["pdf", "PDFs"]];
  let stepT = {}, stepMark = Date.now();
  function timingLine() { const e = Object.entries(stepT); return e.length ? "Timing: " + e.map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}s`).join(" · ") + ` · total ${((Date.now() - pageT0) / 1000).toFixed(0)}s` : ""; }
  const pageT0 = Date.now();
  function step(k, state, title) {   // state: "", "done", "wait", "bad", "skip"
    try { if (!soMode && state) rtCall({ type: "pstep", k, state, title: title || "" }, 3000); } catch {}
    if (state === "done" || state === "bad") { if (!(k in stepT)) { stepT[k] = Date.now() - stepMark; stepMark = Date.now(); } }
    if (!panel) return;
    const el = panel.querySelector(`[data-step="${k}"]`);
    if (!el) return;
    el.className = "st" + (state ? " " + state : "");
    if (title) el.title = title;
  }
  function resetSteps() { stepT = {}; stepMark = Date.now(); STEP_KEYS.forEach(([k]) => step(k, "")); }
  function getRows() { try { return localStorage.getItem(LS_ROWS) || "auto"; } catch { return "auto"; } }
  // "auto": the smallest rows-per-page size that fits every order of the current status (25/50/75/100/250/500/1000)
  function effectiveRows() {
    const w = getRows();
    if (w !== "auto") return w;
    const t = totalOrders();
    if (!t) return "1000";
    return String([25, 50, 75, 100, 250, 500, 1000].find((n) => t <= n) || 1000);   // ShipHero's sizes
  }
  function getAuto() { try { return localStorage.getItem(LS_AUTO) !== "0"; } catch { return true; } }
  function log(msg, cls = "") {
    console.log("[ShipCube Bot]", msg);
    try { if (!soMode) rtCall({ type: "plog", m: String(msg), c: cls }, 3000); } catch {}
    if (!logEl) return;
    const d = document.createElement("div");
    d.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
    if (cls) d.className = cls;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ---------------- finding things ----------------
  function findSection() {
    const title = leafs(document.body).find((el) => own(el) === SECTION_TITLE);
    if (!title) return null;
    let el = title;
    while (el && el !== document.body) {
      const t = own(el);
      if (t.includes("ordered") && /box \d/.test(t)) return el;
      el = el.parentElement;
    }
    return null;
  }

  const directText = (el) => norm([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" "));
  function exactLeaf(root, re) {
    const hits = [...root.querySelectorAll("*")].filter((el) => visible(el) && !el.closest("#shipcube-bot") &&
      (re.test(directText(el)) || (re.test(own(el)) && ![...el.children].some((c) => visible(c) && own(c)))));
    return hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
  }

  function findRows(section) {
    const orderedHdr = exactLeaf(section, /^ordered$/)[0];
    const boxHdrs = exactLeaf(section, /^box \d+/);
    if (!orderedHdr || !boxHdrs.length) return { error: "Couldn't find the 'Ordered' or 'Box 1' column header." };
    const oc = center(orderedHdr);
    const bc = center(boxHdrs[0]);
    const boxColEl = boxHdrs[0];
    // ordered numbers: integers under the Ordered header
    const nums = exactLeaf(section, /^\d+$/).filter((el) => {
      const c = center(el);
      return Math.abs(c.x - oc.x) < 70 && c.y > oc.y + 10;
    });
    const rows = nums.map((el) => {
      const c = center(el);
      return { orderedEl: el, ordered: parseInt(own(el), 10), y: c.y };
    });
    return { rows, boxX: bc.x, boxHdr: boxColEl, boxHdrRect: bc.r };
  }

  function qtyFieldForRow(section, row, boxX) {
    const near = (el) => { const c = center(el); return Math.abs(c.y - row.y) < 35 && Math.abs(c.x - boxX) < 130; };
    const inp = [...section.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea, [contenteditable=true]")]
      .filter((el) => visible(el) && near(el))
      .sort((a, b) => Math.abs(center(a).y - row.y) - Math.abs(center(b).y - row.y));
    if (inp.length) return { el: inp[0], kind: "input" };
    const txt = exactLeaf(section, /^\d+$/).filter((el) => el !== row.orderedEl && near(el))
      .sort((a, b) => Math.abs(center(a).y - row.y) - Math.abs(center(b).y - row.y));
    if (txt.length) return { el: txt[0], kind: "text" };
    return null;
  }

  function setNativeValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    input.focus();
    setter.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    input.blur();
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  }

  function realClick(el) {
    const c = center(el);
    const opts = { bubbles: true, cancelable: true, view: window, clientX: c.x, clientY: c.y, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
  }

  async function fillQty(section, row, boxX) {
    let f = qtyFieldForRow(section, row, boxX);
    if (!f) return false;
    const cur = f.kind === "input" ? f.el.value : own(f.el);
    if (String(cur).trim() === String(row.ordered)) return "already";
    if (f.kind === "text") {            // click-to-edit field
      realClick(f.el);
      await sleep(250);
      const active = document.activeElement;
      if (active && /input|textarea/i.test(active.tagName)) f = { el: active, kind: "input" };
      else f = qtyFieldForRow(section, row, boxX);
      if (!f || f.kind !== "input") return false;
    }
    f.el.scrollIntoView({ block: "center" });
    setNativeValue(f.el, row.ordered);
    await sleep(300);
    const g = qtyFieldForRow(section, row, boxX);
    const now = g ? (g.kind === "input" ? g.el.value : own(g.el)) : "";
    return String(now) === String(row.ordered);
  }

  function customerName() {
    const re = /orders?\s*\(\s*[\d,]+\s+shipments?\s*\)\s*[•·|–-]\s*(.+)$/i;
    for (const el of document.querySelectorAll("h1, h2, h3, [class*=title i]")) {
      if (el.closest("#shipcube-bot")) continue;
      const m = (el.innerText || "").trim().match(re);
      if (m) return m[1].split("\n")[0].trim();
    }
    const m = (document.body.innerText || "").match(/orders?\s*\(\s*[\d,]+\s+shipments?\s*\)\s*[•·|–-]\s*([^\n]+)/i);
    return m ? m[1].trim() : "";
  }
  function rulesForCustomer() {
    const name = norm(customerName());
    for (const key of Object.keys(CUSTOMER_BOX_RULES)) if (name.includes(key)) return { name, rules: CUSTOMER_BOX_RULES[key] };
    return { name, rules: null };
  }
  function boxForUnits(units) {
    return BOX_RULES.find((r) => units <= r.maxUnits).box;
  }


  // ===================== product box rules (ops workbook: item + quantity -> box) =====================
  const DEFAULT_LADDER = ["small bubble mailer", "large bubble mailer", "6x4x3", "9.5x7.5x4", "11x9x3", "11x9x4"];
  const DEFAULT_FALLBACK_BOX = "6x6x6 Box";
  // one spelling per box: dimensions -> "6x4x3", bubble mailers -> "small bubble mailer" / "large bubble mailer"
  function canonBox(s) {
    const t = String(s || "").replace(/ /g, " ").toLowerCase();
    const d = dims(t); if (d) return d;
    if (/bubble|mailer|maile\b/.test(t)) {
      if (/\bsmall\b|\bsm\b/.test(t)) return "small bubble mailer";
      if (/\blarge\b|\blg\b|\bbig\b/.test(t)) return "large bubble mailer";
    }
    return norm(t);
  }
  function prodKey(s) { return String(s || "").replace(/ /g, " ").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
  // "1" -> {1,1}   "1 to 2" -> {1,2}   "2 more" / "2+" -> {2,∞}
  function parseQty(q) {
    const s = String(q == null ? "" : q).toLowerCase(), n = s.match(/\d+/g);
    if (!n) return null;
    const a = +n[0];
    if (/more|\+|\bup\b|above|plus/.test(s)) return { min: a, max: Infinity };
    if (n.length > 1) return { min: Math.min(a, +n[1]), max: Math.max(a, +n[1]) };
    return { min: a, max: a };
  }
  function indexProducts(list) {
    const m = new Map();
    for (const r of list || []) {
      const k = prodKey(r.name), q = parseQty(r.qty);
      if (!k || !q || !String(r.box || "").trim()) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push({ min: q.min, max: q.max, box: canonBox(r.box) });
    }
    return m;
  }
  // exact name, else the workbook name is the start of the ShipHero name ("… - Fair" variants), else the reverse, else contained
  function findProduct(index, pageName) {
    const k = prodKey(pageName); if (!k) return null;
    if (index.has(k)) return { key: k, rules: index.get(k) };
    const keys = [...index.keys()];
    const wordStart = (a, b) => a === b || a.startsWith(b + " ");
    let best = keys.filter((x) => wordStart(k, x)).sort((a, b) => b.length - a.length)[0];
    if (!best) { const c = keys.filter((x) => wordStart(x, k)); if (c.length === 1) best = c[0]; }
    if (!best) best = keys.filter((x) => (" " + k + " ").includes(" " + x + " ")).sort((a, b) => b.length - a.length)[0];
    return best ? { key: best, rules: index.get(best) } : null;
  }
  // many boxes -> one box: 2 small = 1 large, 2 large = 1 6x4x3, 2 boxes = next size, a box takes 1 bubble mailer
  // for free and 2 bubble mailers push it up one size
  function combineBoxes(list, ladder) {
    const lad = (ladder && ladder.length ? ladder : DEFAULT_LADDER).map(canonBox);
    let firstBox = lad.findIndex((x) => !/bubble|mailer/.test(x)); if (firstBox < 0) firstBox = lad.length;
    const ranks = list.map((b) => lad.indexOf(canonBox(b)));
    if (!ranks.length || ranks.some((r) => r < 0)) return null;
    ranks.sort((a, b) => b - a);
    let cur = ranks[0], absorbed = false;
    for (const y of ranks.slice(1)) {
      if (cur < firstBox) { cur += 1; absorbed = false; }                       // bubble + bubble -> next size
      else if (y < firstBox) { if (!absorbed) absorbed = true; else { cur += 1; absorbed = false; } }   // box + bubble(s)
      else { cur = Math.max(cur, y) + 1; absorbed = false; }                    // box + box
    }
    return lad[cur] || null;
  }
  // one line (product x quantity) -> one box
  function lineBox(found, qty, ladder) {
    const rs = found.rules;
    const exact = rs.filter((r) => qty >= r.min && qty <= r.max).sort((a, b) => (a.max - a.min) - (b.max - b.min))[0];
    if (exact) return exact.box;
    const unit = rs.find((r) => 1 >= r.min && 1 <= r.max) || rs.slice().sort((a, b) => a.min - b.min)[0];
    if (!unit) return null;
    const base = rs.filter((r) => r.max < qty).sort((a, b) => b.max - a.max)[0];   // the biggest listed quantity below this one
    const parts = []; let left = qty;
    if (base) { parts.push(base.box); left = qty - base.max; }
    for (let i = 0; i < Math.min(left, 30); i++) parts.push(unit.box);
    return combineBoxes(parts, ladder);
  }
  // lines = [{name, qty}] -> { box (canonical) | null, why }
  function boxForProducts(company, lines) {
    const index = indexProducts(company.products), ladder = company.ladder;
    const parts = [], notes = [], missing = [];
    for (const ln of lines) {
      if (!ln.name) { missing.push("(unreadable item name)"); continue; }
      const f = findProduct(index, ln.name);
      if (!f) { missing.push(ln.name); continue; }
      const b = lineBox(f, ln.qty, ladder);
      if (!b) { missing.push(`${ln.name} ×${ln.qty}`); continue; }
      parts.push(b); notes.push(`${ln.name} ×${ln.qty} → ${b}`);
    }
    if (missing.length) return { box: null, why: `no rule for ${missing.join("; ")}`, notes };
    if (!parts.length) return { box: null, why: "no items read", notes };
    const box = parts.length === 1 ? parts[0] : combineBoxes(parts, ladder);
    if (!box) return { box: null, why: `${parts.join(" + ")} is bigger than the largest box`, notes };
    return { box, why: parts.length > 1 ? `${parts.join(" + ")} → ${box}` : "", notes };
  }
  window.__shipcubeBox = { canonBox, parseQty, combineBoxes, boxForProducts, lineBox, findProduct, indexProducts, prodKey };
  // item names of the "Decide how each individual order will be packed" rows
  function readLines(section, info) {
    const hdr = exactLeaf(section, /^ordered$/)[0];
    if (!hdr) return [];
    const oc = center(hdr);
    const all = leafs(section).filter((el) => !el.closest("#shipcube-bot"));
    return info.rows.map((row) => {
      const cands = all.filter((el) => { const c = center(el); return Math.abs(c.y - row.y) < 45 && c.x < oc.x - 15; })
        .map((el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim())
        .filter((t) => t.length >= 3 && !/^sku\b/i.test(t) && !/^\d+$/.test(t) && !/^(items?|ordered)$/i.test(t))
        .sort((a, b) => b.length - a.length);
      let name = (cands[0] || "").replace(/\s*[·•]\s*$/, "").trim();
      if (!name) {   // name not on the same line as the number: use the smallest block around this row's number that has text
        const bad = (t) => t.length < 3 || /^sku\b/i.test(t) || /^[\d.,$#\s-]+$/.test(t) || /^(items?|ordered|box \d+|packed|remaining|sku|qty|quantity|price)$/i.test(t);
        let blk = row.orderedEl.parentElement;
        for (let i = 0; i < 8 && blk && blk !== section; i++, blk = blk.parentElement) {
          const others = [...blk.querySelectorAll("*")].filter((el) => el !== row.orderedEl && el.children.length === 0 && /^\d+$/.test((el.textContent || "").trim()) && info.rows.some((r) => r.orderedEl === el));
          if (others.length) break;
          const t = leafs(blk).filter((el) => !el.closest("#shipcube-bot")).map((el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim()).filter((x) => !bad(x)).sort((x, y) => y.length - x.length);
          if (t.length) { name = t[0].replace(/\s*[·•]\s*$/, "").trim(); break; }
        }
      }
      return { name, qty: row.ordered };
    });
  }
  // the box the workbook rules want for this page (or the fallback) -> { target, msg, cls }
  function decideProductBox(company, section, info) {
    const fb = company.fallback || DEFAULT_FALLBACK_BOX;
    const lines = readLines(section, info);
    if (lines.some((l) => !l.name)) { try { const near = leafs(section).filter((el) => !el.closest("#shipcube-bot")).map((el) => (el.innerText || "").replace(/\s+/g, " ").trim()).filter((t) => t.length > 2).slice(0, 25); log(`Couldn't read an item name. Texts seen in the packing area: ${near.join(" | ").slice(0, 600)}`, "muted"); } catch {} }
    const r = boxForProducts(company, lines);
    if (!r.box) return { target: fb, fallback: true, msg: `${company.name}: ${r.why} → using the fallback “${fb}”`, cls: "warn", lines };
    const alias = company.alias && company.alias[r.box];
    return { target: alias || r.box, fallback: false, msg: `${company.name}: ${r.notes.join(" + ")}${r.why ? " (" + r.why + ")" : ""} → “${alias || r.box}”`, cls: "", lines };
  }

  function pickOption(options, target) {
    const t = norm(target), td = dims(target);
    const exact = options.find((o) => own(o) === t);
    if (exact) return exact;
    if (!td) {   // no dimensions (e.g. "small bubble mailer"): every important word must be in the option name
      const words = t.replace(/\b(box|mailers?|the)\b/g, " ").split(/\s+/).filter(Boolean);
      if (!words.length) return null;
      const hit = options.filter((o) => { const x = own(o).replace(/^\d+-/, ""); return words.every((w) => x.includes(w)); });
      hit.sort((a, b) => own(a).length - own(b).length);
      return hit[0] || null;
    }
    const same = options.filter((o) => dims(own(o)) === td);
    if (!same.length) return null;
    // prefer plain "<size> box" over variants like "_CH_Box" / "Custom Box"
    same.sort((a, b) => own(a).length - own(b).length);
    return same[0];
  }

  const valText = (el) => (el.tagName === "INPUT" || el.tagName === "SELECT") ? (el.tagName === "SELECT" ? (el.options[el.selectedIndex] || {}).text : el.value) : (el.innerText || el.textContent || "");
  function findBoxTrigger(section, below, boxX) {
    const inArea = (el) => { const c = center(el); return c.y > below && c.y < below + 400 && Math.abs(c.x - boxX) < 200 && !el.closest("#shipcube-bot"); };
    // a) native <select> (even if visually hidden behind a styled box)
    const sel = [...document.querySelectorAll("select")].filter((el) => {
      const r = el.parentElement ? el.parentElement.getBoundingClientRect() : el.getBoundingClientRect();
      const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      return c.y > below && c.y < below + 400 && Math.abs(c.x - boxX) < 200;
    });
    if (sel.length) return { el: sel[0], kind: "select" };
    // b) combobox / button / input showing a box size
    const ctl = [...document.querySelectorAll('[role="combobox"], [aria-haspopup], button, input:not([type=hidden])')]
      .filter((el) => visible(el) && inArea(el) && dims(valText(el) || (el.closest('[role="combobox"],[aria-haspopup]') || el).innerText));
    if (ctl.length) {
      ctl.sort((a, b) => center(a).y - center(b).y);
      return { el: ctl[0], kind: "custom" };
    }
    // c) any text showing a box size
    const cands = leafs(document.body).filter((el) => inArea(el) && dims(own(el)));
    if (!cands.length) return null;
    cands.sort((a, b) => center(a).y - center(b).y);
    let el = cands[0];
    // climb to the clickable control
    for (let p = el, i = 0; p && i < 6; p = p.parentElement, i++) {
      const role = (p.getAttribute && p.getAttribute("role")) || "";
      if (/button|combobox|listbox/.test(role) || p.tagName === "BUTTON" || getComputedStyle(p).cursor === "pointer") { el = p; break; }
    }
    return { el, kind: "custom" };
  }

  function visibleOptions(exclude) {
    const all = [...document.querySelectorAll('[role="option"], li, [class*="option" i], [class*="item" i], [class*="menu" i] div, [role="listbox"] *')]
      .filter((el) => visible(el) && dims(own(el)) && !exclude.contains(el) && !el.closest("#shipcube-bot"));
    // keep only the innermost
    return all.filter((el) => !all.some((o) => o !== el && el.contains(o)));
  }

  async function selectBox(section, trigger, target) {
    if (trigger.kind === "select") {
      const opt = pickOption([...trigger.el.options].map((o) => Object.assign(o, { innerText: o.text })), target);
      if (!opt) return { ok: false, msg: `“${target}” is not in the box list` };
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(trigger.el, opt.value);
      trigger.el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, chosen: opt.text };
    }
    if (norm(valText(trigger.el)) === norm(target)) return { ok: true, chosen: valText(trigger.el), already: true };
    trigger.el.scrollIntoView({ block: "center" });
    await sleep(150);
    realClick(trigger.el);
    let opts = [];
    for (let i = 0; i < 10 && !opts.length; i++) { await sleep(100); opts = visibleOptions(trigger.el); }
    if (!opts.length) {   // try clicking the inner text / arrow, then keyboard
      const inner = trigger.el.querySelector("input, [class*=value i], [class*=indicator i], svg") || trigger.el;
      realClick(inner); inner.focus && inner.focus();
      inner.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true }));
      for (let i = 0; i < 15 && !opts.length; i++) { await sleep(100); opts = visibleOptions(trigger.el); }
    }
    if (!opts.length) return { ok: false, msg: "the box dropdown didn't open" };
    let opt = pickOption(opts, target);
    // list may be long: scroll it to load/see more options
    const scroller = (() => { for (let p = opts[0].parentElement; p; p = p.parentElement) { if (p.scrollHeight > p.clientHeight + 4) return p; } return null; })();
    if (!opt && scroller) {
      scroller.scrollTop = 0; await sleep(120);
      for (let i = 0; i < 60 && !opt; i++) {
        opt = pickOption(visibleOptions(trigger.el), target);
        if (opt) break;
        const before = scroller.scrollTop;
        scroller.scrollTop += Math.max(60, scroller.clientHeight * 0.6);
        await sleep(120);
        if (scroller.scrollTop === before) { opt = pickOption(visibleOptions(trigger.el), target); break; }
      }
    }
    if (!opt) {
      const names = [...new Set(visibleOptions(trigger.el).map(own))].slice(0, 12).join(", ");
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return { ok: false, msg: `couldn't find “${target}” in the list (saw: ${names})` };
    }
    opt.scrollIntoView({ block: "nearest" });
    const chosen = own(opt), shown = (opt.innerText || opt.textContent || "").trim();
    realClick(opt);
    await sleep(350);
    const tr = findBoxTrigger(section, 0, center(trigger.el).x);
    const nowText = tr ? norm(valText(tr.el)) : "";
    return { ok: !tr || nowText === chosen || nowText.includes(chosen), chosen: shown, nowText };
  }

  // ---------------- React internals (bot runs in the page's own context) ----------------
  function fiberOf(el) {
    const k = el && Object.keys(el).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
    return k ? el[k] : null;
  }
  // Returns { options, getOptionLabel, select(option) } for the react-select that owns `el`
  function findSelectProps(el) {
    for (let f = fiberOf(el), i = 0; f && i < 60; f = f.return, i++) {
      const p = f.memoizedProps;
      if (!p) continue;
      // inner react-select parts get "selectOption" = exactly what a click on an option does
      if (typeof p.selectOption === "function" && p.selectProps && Array.isArray(p.selectProps.options))
        return { options: p.selectProps.options, getOptionLabel: p.selectProps.getOptionLabel, name: p.selectProps.name, select: (o) => p.selectOption(o) };
      // the Select component itself
      if (Array.isArray(p.options) && typeof p.onChange === "function" && !("selectProps" in p) && typeof p.onInputChange === "function")
        return { options: p.options, getOptionLabel: p.getOptionLabel, name: p.name, select: (o) => p.onChange(o, { action: "select-option", option: o, name: p.name }) };
    }
    return null;
  }
  function flatOptions(opts) {
    return opts.flatMap((o) => (o && Array.isArray(o.options) ? o.options : [o]));
  }
  // turn a label (plain text OR a React element like <span>6x6x6 Box</span>) into text
  function nodeText(n, depth = 0) {
    if (n == null || typeof n === "boolean" || depth > 12) return "";
    if (typeof n === "string" || typeof n === "number") return String(n);
    if (Array.isArray(n)) return n.map((c) => nodeText(c, depth + 1)).join("");
    if (typeof n === "object" && n.props) return nodeText(n.props.children, depth + 1);
    return "";
  }
  function optionText(o, getOptionLabel) {
    let t = "";
    try { if (getOptionLabel) t = nodeText(getOptionLabel(o)); } catch {}
    if (!t.trim() && o) t = nodeText(o.label) || nodeText(o.name);
    if (!t.trim() && o && typeof o.value === "string") t = o.value.replace(/^\d+-/, ""); // "60149-6x6x6 Box" -> "6x6x6 Box"
    return t.replace(/\s+/g, " ").trim();
  }
  function selectViaReact(el, target) {
    const props = findSelectProps(el);
    if (!props) return { ok: false, msg: "no React select props" };
    const label = (o) => optionText(o, props.getOptionLabel);
    const all = flatOptions(props.options);
    const fake = all.map((o) => ({ innerText: label(o), textContent: label(o), __opt: o }));
    const hit = pickOption(fake, target);
    if (!hit) return { ok: false, msg: `“${target}” not in the list (has: ${fake.slice(0, 12).map((f) => f.innerText).join(", ")})` };
    props.select(hit.__opt);
    return { ok: true, chosen: hit.innerText };
  }

  // ---------------- ShipHero box dropdown (react-select) ----------------
  function findReactSelect(boxX, below) {
    const inputs = [...document.querySelectorAll('input[role="combobox"][id^="react-select"], input[aria-label="Box type selection"]')]
      .filter((el) => !el.closest("#shipcube-bot"));
    const scored = inputs.map((inp) => {
      const ctl = inp.closest('[class*="-control"]') || inp.parentElement;
      const c = center(ctl);
      return { inp, ctl, c, d: Math.abs(c.x - boxX) + (c.y < below ? 10000 : 0) + (inp.getAttribute("aria-label") === "Box type selection" ? 0 : 500) };
    }).sort((a, b) => a.d - b.d);
    if (!scored.length) return null;
    const { inp, ctl } = scored[0];
    const container = ctl.parentElement;
    return {
      inp, ctl, container,
      current: () => {
        const sv = container.querySelector('[class*="singleValue"]');
        return (sv ? sv.innerText : "").trim();
      },
      hidden: () => { const h = container.querySelector('input[type="hidden"][name="box"]') || container.querySelector('input[type="hidden"]'); return h ? h.value : ""; },
      prefix: inp.id ? inp.id.replace(/-input$/, "-option-") : null,
    };
  }

  function rsOptions(rs) {
    let opts = rs.prefix ? [...document.querySelectorAll(`[id^="${rs.prefix}"]`)] : [];
    if (!opts.length) opts = [...document.querySelectorAll('[class*="-option"], [role="option"]')];
    return opts.filter(visible);
  }

  function typeInto(input, text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function selectReactSelect(rs, target) {
    if (norm(rs.current()) === norm(target)) return { ok: true, chosen: rs.current(), already: true };
    // 1) fastest + most reliable: call ShipHero's own onChange for the dropdown
    const direct = selectViaReact(rs.inp, target);
    if (direct.ok) {
      await sleep(400);
      if (norm(rs.current()) === norm(direct.chosen) || rs.hidden().toLowerCase().includes(norm(direct.chosen)))
        return { ok: true, chosen: direct.chosen, nowText: rs.current(), hidden: rs.hidden(), how: "direct" };
    } else if (!/no React/.test(direct.msg)) {
      log(`(direct select didn't work: ${direct.msg.slice(0, 120)} — trying the list instead)`);
    }
    // 2) fallback: open the list and click like a person
    rs.ctl.scrollIntoView({ block: "center" });
    await sleep(150);
    rs.inp.focus();
    realClick(rs.ctl);                       // react-select opens on mousedown
    let opts = [];
    for (let i = 0; i < 10 && !opts.length; i++) { await sleep(100); opts = rsOptions(rs); }
    // narrow the list by typing the size (e.g. "6x6x6")
    typeInto(rs.inp, dims(target) || target);
    await sleep(350);
    opts = rsOptions(rs);
    if (!opts.length) {
      rs.inp.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true }));
      for (let i = 0; i < 10 && !opts.length; i++) { await sleep(100); opts = rsOptions(rs); }
    }
    if (!opts.length) {
      typeInto(rs.inp, ""); rs.inp.blur();
      return { ok: false, msg: "the box dropdown didn't open / no matching sizes" };
    }
    const opt = pickOption(opts, target);
    if (!opt) {
      const names = opts.map((o) => o.innerText.trim()).slice(0, 10).join(", ");
      typeInto(rs.inp, "");
      rs.inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
      return { ok: false, msg: `“${target}” not in the list (saw: ${names})` };
    }
    const shown = opt.innerText.trim();
    opt.scrollIntoView({ block: "nearest" });
    realClick(opt);
    await sleep(400);
    const now = rs.current();
    rs.inp.blur();
    return { ok: norm(now) === norm(shown), chosen: shown, nowText: now, hidden: rs.hidden() };
  }

  // ---------------- rows per page ----------------
  async function setRowsPerPage(manual = false) {
    const want = effectiveRows();
    if (want === "off") { if (manual) log("Rows per page: set to “don't change”."); return; }
    const lbl = [...document.querySelectorAll("*")].find((el) => visible(el) && directText(el) === "rows per page" && !el.closest("#shipcube-bot"));
    if (!lbl) { if (manual) log("Couldn't find “Rows per page” on this page (scroll to the order list first?).", "warn"); return; }
    let box = lbl;
    for (let i = 0; i < 4 && box.parentElement; i++) {
      box = box.parentElement;
      if (box.querySelector("select, input:not([type=hidden]), [role=combobox]")) break;
    }
    const sel = box.querySelector("select");
    if (sel) {
      const opt = [...sel.options].find((o) => o.text.trim() === want || o.value === want);
      if (!opt) { log(`Rows per page: ${want} is not an option here.`, "bad"); return; }
      if (sel.value === opt.value) { log(`Rows per page already ${want} ✓`, "ok"); return; }
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, opt.value);
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      log(`Rows per page set to ${want} ✓`, "ok");
      return true;
    }
    const rsInput = box.querySelector('input[role="combobox"]');
    if (rsInput) {
      const ctl = rsInput.closest('[class*="-control"]') || rsInput.parentElement;
      const sv = () => ((ctl.querySelector('[class*="singleValue"]') || {}).innerText || "").trim();
      if (sv() === want) { log(`Rows per page already ${want} ✓`, "ok"); return; }
      const r = selectViaReact(rsInput, want);
      log(r.ok ? `Rows per page set to ${want} ✓` : `Rows per page not changed: ${r.msg}`, r.ok ? "ok" : "bad");
      return r.ok;
    }
    const inp = box.querySelector("input:not([type=hidden])");
    if (inp) {
      if (inp.value === want) { log(`Rows per page already ${want} ✓`, "ok"); return; }
      setNativeValue(inp, want);
      log(`Rows per page set to ${want} (typed) - check the list`, "ok");
      return true;
    }
    log("Found “Rows per page” but not its control - please send debug info.", "bad");
  }

  // wait until the page stops changing (after ShipHero reloads the order list)
  function settle(quietMs = 1500, maxMs = 12000) {
    return new Promise((resolve) => {
      let t, done = false;
      const finish = () => { if (done) return; done = true; obs.disconnect(); clearTimeout(t); clearTimeout(cap); resolve(); };
      const obs = new MutationObserver((muts) => {
        if (muts.every((m) => m.target.closest && m.target.closest("#shipcube-bot"))) return;
        clearTimeout(t); t = setTimeout(finish, quietMs);
      });
      obs.observe(document.body, { childList: true, subtree: true, characterData: true });
      t = setTimeout(finish, quietMs);
      const cap = setTimeout(finish, maxMs);
    });
  }

  // remember when a person touches the box dropdown, so the bot never overrides them
  let userTouchedBox = 0;
  ["mousedown", "keydown", "touchstart"].forEach((ev) =>
    document.addEventListener(ev, (e) => {
      if (e.isTrusted && e.target && e.target.closest && e.target.closest('[class*="-container"]') &&
          e.target.closest('[class*="-container"]').querySelector('input[aria-label="Box type selection"]')) userTouchedBox = Date.now();
    }, true));

  // Keep watching while the page is open: if ShipHero resets the box/quantity
  // (it does after the order list reloads), put them back. Stops if a person
  // touches the box dropdown, and never fixes more than 10 times per page.
  let guardTimer = null, guardFixes = 0, guardUrl = null, guardBusy = false, lastDecision = null, learnBusy = false;
  // a person changed the box the bot chose: offer to remember it as a rule (single-item orders)
  async function offerLearn() {
    if (learnBusy || !lastDecision) return;
    learnBusy = true;
    try {
      await sleep(5000);
      const sec = findSection(); if (!sec) return;
      const info = findRows(sec); if (info.error || !info.rows.length) return;
      const rs = findReactSelect(info.boxX, Math.max(...info.rows.map((r) => r.y)));
      const cur = rs && rs.current && rs.current(); if (!cur) return;
      const now = canonBox(cur);
      if (now === canonBox(lastDecision.target) || now === norm(lastDecision.target)) return;
      const lines = lastDecision.lines.filter((l) => l.name);
      if (lines.length !== 1) { log(`You changed the box to “${cur}”. This order has ${lines.length || "unknown"} items, so I can't turn it into a single-item rule — add it in Settings → Products if it should repeat.`, "muted"); return; }
      const ln = lines[0], co = lastDecision.company;
      showLearn(`Save rule: ${ln.name} × ${ln.qty} → ${cur}?`, () => {
        const list = loadCompanies(), c0 = list.find((x) => x.name === co);
        if (!c0) { log("Company not found — rule not saved.", "bad"); return; }
        if (!(c0.ladder || []).includes(now)) { log(`“${cur}” isn't on ${co}'s box ladder — add it in Settings → Products first.`, "warn"); return; }
        const rule = { name: ln.name, qty: String(ln.qty), box: now };
        c0.products = [rule].concat((c0.products || []).filter((x) => !(prodKey(x.name) === prodKey(rule.name) && String(x.qty) === rule.qty)));
        const back = boxForProducts(c0, [{ name: ln.name, qty: ln.qty }]);
        if (back.box !== now) { log(`Rule not saved: an existing wider rule for ${ln.name} still wins — please edit it in Settings → Products.`, "warn"); return; }
        saveCompanies(list); log(`Rule saved ✓ ${ln.name} × ${ln.qty} → ${cur}`, "ok");
      });
    } finally { learnBusy = false; }
  }
  function showLearn(text, onYes) {
    if (!panel) return;
    const old = panel.querySelector(".sc-learn"); if (old) old.remove();
    const el = document.createElement("div"); el.className = "sc-learn cd";
    el.style.cssText = "margin-top:8px;padding:8px;border-radius:8px;background:#EEF2FF;border:1px solid #C7D2FE;font-size:12px";
    el.innerHTML = `<div class="t"></div><div class="row" style="margin-top:6px"><button class="p" data-l="y">Save rule</button><button data-l="n">No</button></div>`;
    el.querySelector(".t").textContent = text;
    el.querySelector('[data-l="y"]').onclick = () => { el.remove(); onYes(); };
    el.querySelector('[data-l="n"]').onclick = () => el.remove();
    panel.appendChild(el);
  }
  function guardBox(target, chosen) {
    clearInterval(guardTimer);
    if (guardUrl !== pageKey()) { guardUrl = pageKey(); guardFixes = 0; }
    const started = Date.now();
    guardTimer = setInterval(async () => {
      if (guardBusy || running) return;
      if (pageKey() !== guardUrl || userTouchedBox > started || guardFixes >= 10) { clearInterval(guardTimer); if (userTouchedBox > started && pageKey() === guardUrl) offerLearn(); return; }
      const sec = findSection(); if (!sec) return;
      const info = findRows(sec); if (info.error || !info.rows.length) return;
      const rs = findReactSelect(info.boxX, Math.max(...info.rows.map((r) => r.y)));
      if (!rs || !rs.current()) return;
      const boxWrong = chosen ? norm(rs.current()) !== norm(chosen) : false;
      const qtyWrong = info.rows.some((row) => {
        const f = qtyFieldForRow(sec, row, info.boxX);
        const v = f ? (f.kind === "input" ? f.el.value : own(f.el)) : "";
        return f && String(v).trim() !== String(row.ordered);
      });
      // ShipHero cleared the selection by itself (not you) -> tick select-all again
      if (getFlag(LS_SELALL, true) && selectAllDoneUrl === pageKey() && selectAllAt && userTouchedSelect < selectAllAt) {
        const h = findHeaderCheckbox();
        const selN = selectedCount(h), shownN = countOrders();
        const cleared = h && !isChecked(h.cb) && selN === null;
        const partial = h && selN !== null && selN < shownN;
        if (cleared || partial) {
          guardBusy = true;
          log(cleared ? "ShipHero cleared the order selection — selecting all again" : `Only ${selN} of ${shownN} orders selected — selecting all again`, "warn");
          await waitForOrders(shownN);          // let a reload finish first
          selectAllDoneUrl = null; await selectAllOrders(false);
          guardBusy = false;
          return;
        }
      }
      if (!boxWrong && !qtyWrong) return;
      guardBusy = true; guardFixes++;
      log(`ShipHero reset the packing (${boxWrong ? "box → “" + rs.current() + "”" : "quantity"}) — fixing it again`, "warn");
      await sleep(800);           // let ShipHero finish its own update first
      await run(false, true);
      guardBusy = false;
    }, 1500);
  }

  // ---------------- top order ID -> clipboard ----------------
  const LS_AUTOCOPY = "shipcubeBot.autocopy", LS_HASH = "shipcubeBot.hash";
  function getFlag(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v === "1"; } catch { return d; } }
  function setFlag(k, v) { try { localStorage.setItem(k, v ? "1" : "0"); } catch {} }
  let lastCopied = null, pendingCopy = null;

  // The orders table = the table whose header has the select-all checkbox.
  let orderColIdx = null;
  function ordersTable() {
    const h = findHeaderCheckbox();
    const t = h && h.row.closest("table");
    if (!t) return null;
    const ths = [...h.row.querySelectorAll("th, [role=columnheader]")];
    const i = ths.findIndex((th) => norm(th.innerText) === "order");
    if (i >= 0) orderColIdx = i;
    return t;
  }
  function orderRows() {
    const t = ordersTable();
    if (!t) return null;
    return [...t.querySelectorAll("tbody tr")].filter((tr) => tr.querySelector('input[type="checkbox"], [role="checkbox"]'));
  }
  function orderIdOfRow(tr) {
    const cells = [...tr.querySelectorAll("td, [role=cell]")];
    const pick = (c) => (c ? (c.innerText || c.textContent || "").trim().split("\n")[0].trim() : "");
    if (orderColIdx != null && cells[orderColIdx]) { const v = pick(cells[orderColIdx]); if (v) return v; }
    for (const c of cells) { const v = pick(c); if (/^#?[A-Za-z0-9][A-Za-z0-9._-]{3,}$/.test(v)) return v; }  // fallback
    return "";
  }
  function findTopOrderId() {
    const rows = orderRows();
    if (rows && rows.length) { const id = orderIdOfRow(rows[0]); if (id) return id; }
    // older fallback: first "#1234567" on the page
    for (const el of document.querySelectorAll("a, td, span, div, p")) {
      if (el.closest("#shipcube-bot")) continue;
      const t = (el.childElementCount === 0 ? el.textContent : directText(el)).trim();
      if (/^#\d{4,}$/.test(t) && visible(el)) return t;
    }
    return null;
  }

  async function writeClipboard(text) {
    try {   // never wait on a permission prompt (would stall the batch / sheet queue)
      const ok = await Promise.race([navigator.clipboard.writeText(text).then(() => true), sleep(2500).then(() => false)]);
      if (ok) return true;
    } catch {}
    try {   // older fallback
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch { return false; }
  }

  // Chrome only lets pages copy while the tab is focused; if it fails, copy on the next click/key in the page
  function copyOnNextInteraction(text) {
    pendingCopy = text;
    const go = async () => {
      window.removeEventListener("pointerdown", go, true); window.removeEventListener("keydown", go, true);
      if (pendingCopy !== text) return;
      if (await writeClipboard(text)) { lastCopied = text; pendingCopy = null; log(`Top order ${text} copied to clipboard ✓`, "ok"); }
    };
    window.addEventListener("pointerdown", go, true); window.addEventListener("keydown", go, true);
  }

  async function checkTopOrder(manual = false) {
    if (!panel) return;
    const raw = findTopOrderId();
    const shown = panel.querySelector('[data-a="topid"]');
    if (!raw) { shown.textContent = "—"; if (manual) log("No order list found yet (it may still be loading).", "warn"); return; }
    const id = getFlag(LS_HASH, true) ? raw : raw.replace(/^#/, "");
    shown.textContent = id;
    if (!manual && (!getFlag(LS_AUTOCOPY, true) || id === lastCopied || id === pendingCopy)) return;
    if (await writeClipboard(id)) { lastCopied = id; pendingCopy = null; log(`Top order ${id} copied to clipboard ✓`, "ok"); }
    else { log(`Top order ${id} — will copy when you click on the page`, "warn"); copyOnNextInteraction(id); }
  }

  // ---------------- select all orders (header checkbox) ----------------
  const LS_SELALL = "shipcubeBot.selall";
  let selectAllDoneUrl = null, userTouchedSelect = 0, selectAllAt = 0;
  document.addEventListener("click", (e) => {
    if (!e.isTrusted || !e.target || !e.target.closest || e.target.closest('#shipcube-bot, [class*="-menu"], [role="listbox"], [role="option"]')) return;
    const cell = e.target.closest("td, th, [role=cell], [role=columnheader]");
    const isCb = e.target.matches('input[type="checkbox"], [role="checkbox"]') || (cell && cell.querySelector('input[type="checkbox"], [role="checkbox"]'));
    if (isCb && e.target.closest("tr, [role=row]")) userTouchedSelect = Date.now();
  }, true);
  const isChecked = (el) => !!(el.checked || el.getAttribute("aria-checked") === "true" ||
    /(^|\s|-)(checked|is-checked|active)(\s|$)/i.test(el.className || ""));
  function findHeaderCheckbox() {
    const boxes = [...document.querySelectorAll('input[type="checkbox"], [role="checkbox"]')]
      .filter((el) => !el.closest("#shipcube-bot"));
    for (const cb of boxes) {
      let row = cb.closest("tr, [role=row]");
      if (!row) { row = cb; for (let i = 0; i < 4 && row.parentElement; i++) row = row.parentElement; }
      const t = norm(row.innerText || "");
      if ((t.includes("order date") && t.includes("ship by")) || /\b\d+ selected\b/.test(t)) return { cb, row };
    }
    return null;
  }
  function countOrders() {
    const rows = orderRows();
    if (rows) return rows.length;
    const seen = new Set();
    for (const el of document.querySelectorAll("a, td, span, div, p")) {
      if (el.childElementCount !== 0 || el.closest("#shipcube-bot")) continue;
      const t = (el.textContent || "").trim();
      if (/^#\d{4,}$/.test(t)) seen.add(t);
    }
    return seen.size;
  }
  function totalOrders() {
    const m = (document.body.innerText || "").match(/(\d[\d,]*)\s+orders?\s*\(/i);   // "2000 orders (3151 shipments)"
    return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
  }
  function selectedCount(h) {
    const m = h && norm(h.row.innerText || "").match(/(\d+) selected/);
    return m ? parseInt(m[1], 10) : null;
  }
  // wait until ShipHero has really put all the rows on the page (not just the first 50)
  function nextPageButton() {
    const arrows = document.querySelector(".footer__arrows");
    const btns = arrows ? arrows.querySelectorAll("button") : [];
    return btns.length >= 2 ? btns[btns.length - 1] : null;
  }
  async function waitForOrders(startCount) {
    const want = parseInt(effectiveRows(), 10);
    if (!want) return;
    const total = totalOrders();
    const expected = Math.min(want, total || Infinity);
    let last = countOrders(), lastChange = Date.now();
    const t0 = Date.now();
    const allOnPage = () => { const nb = nextPageButton(); return nb && nb.disabled; };
    if (!findHeaderCheckbox() && last === 0) return;               // no order list on this page
    if (last >= expected || (allOnPage() && last > 0)) return;
    log(`Waiting for all orders to load (${last} of ${expected === Infinity ? want : expected})…`);
    while (Date.now() - t0 < 60000) {
      await sleep(500);
      const c = countOrders();
      if (c !== last) { last = c; lastChange = Date.now(); }
      const quiet = Date.now() - lastChange;
      if (c >= expected) break;                                   // reached rows setting / total
      const nb = nextPageButton();
      if (nb && nb.disabled && c > 0 && quiet > 1500) break;      // no more pages -> everything is shown
      if (!nb && quiet > 3000) break;                             // can't tell -> stop after 3s of no change
      if (nb && !nb.disabled && c > startCount && quiet > 8000) break; // grew, then stopped growing
    }
    await sleep(800);
    log(`Order list loaded: ${countOrders()} orders ✓`, "ok");
  }
  async function toggleHeader(h) {
    if (h.cb.tagName === "INPUT") h.cb.click(); else realClick(h.cb);
    await sleep(700);
  }
  async function selectAllOrders(manual = false) {
    if (!manual && (!getFlag(LS_SELALL, true) || selectAllDoneUrl === pageKey())) return;
    const h = findHeaderCheckbox();
    if (!h) { if (manual) log("Couldn't find the select-all checkbox (is the order list loaded?)", "warn"); return; }
    selectAllDoneUrl = pageKey();           // only once per page - respect a manual untick later
    const rows = countOrders();
    let sel = selectedCount(h);
    if (isChecked(h.cb) && (sel === null || sel >= rows)) { selectAllAt = Date.now(); log(`All orders already selected${sel ? ` (${sel})` : ""} ✓`, "ok"); return; }
    if (isChecked(h.cb) || (sel !== null && sel > 0)) { await toggleHeader(h); }   // partly selected (e.g. only 50) -> clear first
    let h2 = findHeaderCheckbox();
    if (h2) await toggleHeader(h2);
    h2 = findHeaderCheckbox();
    sel = selectedCount(h2);
    if (sel !== null && sel < countOrders()) {           // still short -> one more clean try
      await toggleHeader(h2); h2 = findHeaderCheckbox(); if (h2) await toggleHeader(h2);
      h2 = findHeaderCheckbox(); sel = selectedCount(h2);
    }
    selectAllAt = Date.now();
    const shown = countOrders();
    if (sel !== null) log(`Selected all orders (${sel} selected of ${shown} shown)${sel < shown ? " — please check" : " ✓"}`, sel < shown ? "warn" : "ok");
    else if (h2 && isChecked(h2.cb)) log(`Selected all orders ✓`, "ok");
    else log("Clicked select-all but couldn't confirm it - please check", "warn");
  }

  // ---------------- picking locations (ops team spec) ----------------
  const LS_PICKLOC = "shipcubeBot.pickloc";
  const LOC_FULL = /^[A-Z]{2,6}-\d+-[A-Z0-9]{1,4}-\d+$/i;   // SCR-102-A-1481
  let pickDoneUrl = null, pickBusy = false, lastPanelHtml = "";

  // parse "SCR-102-A-1481" -> parts (spec section 6)
  function parseLocation(text) {
    const normalized = String(text || "").replace(/\s+/g, "").toUpperCase();
    const parts = normalized.split("-");
    const isNum = (x) => /^\d+$/.test(x || "");
    const zone = parts[2] || "";
    const ok = parts.length >= 4 && isNum(parts[1]) && isNum(parts[3]) && /^[A-Z]+$/.test(zone);
    return {
      raw: text, normalized, prefix: parts[0] || "",
      middle: isNum(parts[1]) ? parseInt(parts[1], 10) : Infinity,
      zone, final: isNum(parts[3]) ? parseInt(parts[3], 10) : Infinity,
      single: /^[A-Z]$/.test(zone), malformed: !ok,
    };
  }
  // Zone priority: single letters A..Z first (alphabetical), then PA, then KB, then any other zone.
  const LS_ZONES = "shipcubeBot.zones";
  const DEFAULT_ZONE_ORDER = "A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z,PA,KB";
  function zoneOrder() { try { return (localStorage.getItem(LS_ZONES) || DEFAULT_ZONE_ORDER); } catch { return DEFAULT_ZONE_ORDER; } }
  function zoneRank(z) {
    const list = zoneOrder().toUpperCase().split(/[\s,>]+/).filter(Boolean);
    const i = list.indexOf(String(z || "").toUpperCase());
    return i >= 0 ? i : list.length + (String(z || "").length === 1 ? 0 : 1);   // unlisted zones go last
  }
  // enough qty -> zone priority (A..I.., PA, KB) -> smallest final no. -> middle no. -> text   (the Pickable ✓/✗ column is ignored, per ops)
  function chooseBestLocation(locs, toPick, onlyPick) {
    const notes = [];
    const eligible = [];
    for (const l of locs) {
      const p = parseLocation(l.location);
      if (onlyPick && l.pickable === false) { notes.push(`[SKIP] ${p.normalized} | reason=red X (this client only takes items from ✓ locations)`); continue; }
      if (toPick != null && l.inLocation != null && l.inLocation < toPick) { notes.push(`[SKIP] ${p.normalized} | reason=only ${l.inLocation} in location (need ${toPick})`); continue; }
      eligible.push(Object.assign({}, l, p));
    }
    const valid = eligible.filter((x) => !x.malformed);
    const pool0 = valid.length ? valid : eligible;            // malformed only if nothing else
    if (!valid.length && eligible.length) notes.push("[WARN] only malformed location codes are eligible");
    const single = pool0.filter((x) => x.single);
    const pool = pool0.slice();
    pool0.forEach((x) => notes.push(`[CANDIDATE] ${x.normalized} | zone=${x.zone} (priority ${zoneRank(x.zone) + 1}) | final=${x.final === Infinity ? "?" : x.final}${x.inLocation != null ? " | in location=" + x.inLocation : ""}${x.pickable === false ? " | red X (allowed for this client)" : ""}`));
    const rank = (z) => zoneRank(z);
    pool.sort((a, b) => (rank(a.zone) - rank(b.zone)) || (a.zone < b.zone ? -1 : a.zone > b.zone ? 1 : 0) || (a.final - b.final) || (a.middle - b.middle) ||
      (a.normalized < b.normalized ? -1 : a.normalized > b.normalized ? 1 : 0));
    return { selected: pool[0] || null, notes, eligibleCount: eligible.length };
  }
  // clients that only want items from ✓ (pickable) locations: Settings > Box rules > "Only pick from ✓ locations"
  function pickOnlyTick() { try { const co = companyForPage().company; return !!(co && co.onlyPick); } catch { return false; } }
  window.__shipcubeChooseBestLocation = chooseBestLocation;   // for testing

  function findPickCard() {
    const title = [...document.querySelectorAll("*")].find((el) => visible(el) && directText(el) === "pick items" && !el.closest("#shipcube-bot"));
    if (!title) return null;
    let el = title;
    while (el && el !== document.body) {
      const t = norm(el.innerText || "");
      if (t.includes("to pick") && t.includes("locations")) return el;
      el = el.parentElement;
    }
    return null;
  }
  function clickableUp(el, card) {
    for (let p = el, i = 0; p && p !== card && i < 5; p = p.parentElement, i++) {
      const role = p.getAttribute && p.getAttribute("role");
      if (p.tagName === "BUTTON" || p.tagName === "A" || role === "button" || getComputedStyle(p).cursor === "pointer") return p;
    }
    return el;
  }
  // one entry per item row: its Locations button + To pick qty + SKU
  function pickRows(card) {
    const locHdr = exactLeaf(card, /^locations?$/)[0];
    const pickHdr = exactLeaf(card, /^to pick$/)[0];
    const hx = locHdr ? center(locHdr).x : null;
    const leaves = [...card.querySelectorAll("*")].filter((el) => visible(el) && el.childElementCount === 0 &&
      /^[A-Z]{2,6}-[\dA-Z]/i.test((el.textContent || "").trim()) && !/^sku/i.test((el.textContent || "").trim()));
    const seen = new Set(), rows = [];
    for (const lf of leaves) {
      if (hx != null && Math.abs(center(lf).x - hx) > 220) continue;
      const btn = clickableUp(lf, card);
      if (seen.has(btn)) continue; seen.add(btn);
      const y = center(btn).y;
      let toPick = null;
      if (pickHdr) {
        const px = center(pickHdr).x;
        const n = exactLeaf(card, /^[\d,]+$/).find((e) => Math.abs(center(e).x - px) < 80 && Math.abs(center(e).y - y) < 30);
        if (n) toPick = parseInt(own(n).replace(/,/g, ""), 10);
      }
      let sku = "";
      const skuEl = [...card.querySelectorAll("*")].filter((e) => visible(e) && /^sku/i.test(directText(e)) && Math.abs(center(e).y - y) < 40)
        .sort((a, b) => Math.abs(center(a).y - y) - Math.abs(center(b).y - y))[0];
      if (skuEl) sku = (skuEl.parentElement ? skuEl.parentElement.innerText : skuEl.innerText).replace(/^\s*sku\s*/i, "").trim();
      rows.push({ btn, y, toPick, sku, label: (lf.textContent || "").trim() });
    }
    return rows.sort((a, b) => a.y - b.y);
  }
  function findLocationPanel() {
    const t = [...document.querySelectorAll("*")].find((el) => visible(el) && directText(el) === "change picking location" && !el.closest("#shipcube-bot"));
    if (!t) return null;
    let el = t;
    while (el && el !== document.body) {
      const hasSave = [...el.querySelectorAll("button")].some((b) => /^save$/i.test((b.innerText || "").trim()));
      const locCount = [...el.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && LOC_FULL.test((e.textContent || "").trim())).length;
      if (hasSave && locCount) return el;
      el = el.parentElement;
    }
    return t.closest("section, [role=dialog], [class*=modal i], [class*=drawer i], [class*=panel i]") || null;
  }
  function colourOf(c) {
    if (!c) return null;
    let m = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if (m) return [+m[1], +m[2], +m[3]];
    m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) { let h = m[1]; if (h.length === 3) h = h.split("").map((x) => x + x).join(""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
    return null;
  }
  // green check = true, red X = false, can't tell = null
  function detectPickable(row, pickHdrX) {
    let els = [...row.querySelectorAll("svg, img, i, span, div, use, path, [class], [aria-label], [title]")];
    if (pickHdrX != null) {
      // the cell(s) under the "Pickable" header, plus everything inside them (icons are often 0-size)
      const near = els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && Math.abs(r.left + r.width / 2 - pickHdrX) < 70 && !LOC_FULL.test((e.textContent || "").trim()); });
      if (near.length) {
        const set = new Set();
        near.forEach((n) => { set.add(n); n.querySelectorAll("*").forEach((d) => set.add(d)); });
        els = [...set];
      }
    }
    let green = 0, red = 0;
    for (const e of els) {
      if (LOC_FULL.test((e.textContent || "").trim())) continue;
      const attrs = ["class", "alt", "title", "aria-label", "data-icon", "data-testid", "src", "href", "xlink:href", "name", "fill", "stroke", "color", "data-color", "data-status"]
        .map((a) => (e.getAttribute && e.getAttribute(a)) || "").join(" ").toLowerCase()
        + " " + (e.tagName === "svg" ? ((e.querySelector("title") || {}).textContent || "").toLowerCase() : "");
      if (/--red\b|--danger\b|--error\b/.test(attrs)) red += 3;              // ShipHero: fill="var(--red)"
      else if (/--green\b|--success\b/.test(attrs)) green += 3;              // ShipHero: fill="var(--green)"
      else if (/(not[-_ ]?pickable|unpickable|cross|close|times|error|invalid|denied|reject|cancel|remove|\bx\b|x-icon|icon-x|red)/.test(attrs)) red++;
      else if (/(check|tick|success|valid|approved|pickable|green|yes)/.test(attrs)) green++;
      const txt = (e.childElementCount === 0 ? (e.textContent || "") : "").trim().toLowerCase();
      if (/^(yes|✓|✔)$/.test(txt)) green++;
      if (/^(no|✗|✕|×|x)$/.test(txt)) red++;
      const cs = getComputedStyle(e);
      for (const c of [e.getAttribute && e.getAttribute("fill"), e.getAttribute && e.getAttribute("stroke"), cs.fill, cs.stroke, e.tagName === "svg" || e.tagName === "path" || e.tagName === "I" ? cs.color : null]) {
        const rgb = colourOf(c);
        if (!rgb) continue;
        const [r, g, b] = rgb;
        if (g >= 100 && g > r + 40 && g > b + 10) green++;
        else if (r >= 150 && r > g + 60 && r > b + 40) red++;
      }
    }
    if (green > red) return true;
    if (red > green) return false;
    return null;
  }
  function readPanelLocations(panel) {
    const locLeaves = [...panel.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && LOC_FULL.test((e.textContent || "").trim()) && visible(e));
    const pickHdr = exactLeaf(panel, /^pickable$/)[0], inHdr = exactLeaf(panel, /^in location$/)[0];
    const phx = pickHdr ? center(pickHdr).x : null, ihx = inHdr ? center(inHdr).x : null;
    const count = (el) => [...el.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && LOC_FULL.test((e.textContent || "").trim())).length;
    return locLeaves.map((leaf) => {
      let row = leaf;
      while (row.parentElement && row.parentElement !== panel && count(row.parentElement) === 1) row = row.parentElement;
      let inLocation = null;
      const nums = [...row.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && /^[\d,]+$/.test((e.textContent || "").trim()) && !LOC_FULL.test((e.textContent || "").trim()));
      if (nums.length) {
        const pick = ihx != null ? nums.sort((a, b) => Math.abs(center(a).x - ihx) - Math.abs(center(b).x - ihx))[0] : nums[nums.length - 1];
        inLocation = parseInt(pick.textContent.replace(/,/g, ""), 10);
      }
      return { location: leaf.textContent.trim(), leaf, row, pickable: detectPickable(row, phx), inLocation };
    });
  }
  async function closePanel(panel) {
    const cancel = [...(panel || document).querySelectorAll("button")].find((b) => /^(cancel|close)$/i.test((b.innerText || b.getAttribute("aria-label") || "").trim()));
    if (cancel) cancel.click(); else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
    for (let i = 0; i < 20 && findLocationPanel(); i++) await sleep(150);
  }
  function saveButton(panel) {
    const b = [...panel.querySelectorAll("button")].find((x) => /^save$/i.test((x.innerText || "").trim()) && visible(x));
    if (b) return b;
    try { // fallback XPath supplied by the ops team
      return document.evaluate("/html/body/section/div/div/footer/div[2]/div[2]/button", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    } catch { return null; }
  }
  async function pickLocations(manual = false) {
    if (!manual && !getFlag(LS_PICKLOC, true)) { step("loc", "skip", "switched off"); return; }
    if (!manual && pickDoneUrl === pageKey()) return;
    const card = findPickCard();
    if (!card) { step("loc", "skip", "no Pick items section"); if (manual) log("Couldn't find the “Pick items” section.", "warn"); return; }
    pickDoneUrl = pageKey(); pickBusy = true;
    try {
      const first = pickRows(card);
      if (!first.length) { log("[PICKING] No item rows with a Locations button found — skipped", "warn"); return; }
      log(`[PICKING] Found ${first.length} item row(s)`);
      let ok = 0;
      for (let i = 0; i < first.length; i++) {
        const rows = pickRows(findPickCard() || card);              // re-query after every save
        const row = rows[i];
        if (!row) { log(`[ITEM ${i + 1}] row disappeared — stopped`, "bad"); break; }
        const tag = `[ITEM ${i + 1}]${row.sku ? " SKU=" + row.sku : ""}${row.toPick != null ? " | To pick=" + row.toPick : ""}`;
        row.btn.scrollIntoView({ block: "center" });
        realClick(row.btn);
        let panel = null;
        for (let t = 0; t < 40 && !panel; t++) { await sleep(150); panel = findLocationPanel(); }
        if (!panel) { realClick(row.btn); for (let t = 0; t < 30 && !panel; t++) { await sleep(150); panel = findLocationPanel(); } }
        if (!panel) { log(`${tag} — the location panel didn't open`, "bad"); continue; }
        await sleep(400);
        let locs = readPanelLocations(panel);
        for (let t = 0; t < 10 && !locs.length; t++) { await sleep(300); locs = readPanelLocations(panel); }
        lastPanelHtml = panel.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, (m) => m.slice(0, 400)).slice(0, 15000);
        const { selected, notes, eligibleCount } = chooseBestLocation(locs, row.toPick, pickOnlyTick());
        log(`${tag} — ${locs.length} location(s)`);
        notes.forEach((n) => log(n, "muted"));
        if (!locs.length) { log(`${tag} — couldn't read the locations list; not saving`, "bad"); await closePanel(panel); continue; }
        if (!selected) { log(`${tag} — no location with enough stock; not saving`, "bad"); await closePanel(panel); continue; }
        log(`[SELECT] ${selected.normalized} | zone=${selected.zone} | final=${selected.final === Infinity ? "?" : selected.final}${selected.inLocation != null ? " | in location=" + selected.inLocation : ""}`);
        const pick = locs.find((l) => l.location.replace(/\s+/g, "").toUpperCase() === selected.normalized);
        const radio = pick.row.querySelector('input[type="radio"], input[type="checkbox"], [role="radio"]');
        if (radio) radio.click(); else { realClick(pick.leaf); realClick(pick.row); }
        await sleep(300);
        const save = saveButton(panel);
        if (!save) { log(`${tag} — Save button not found; not saved`, "bad"); await closePanel(panel); continue; }
        if (save.disabled) { await sleep(500); }
        if (save.disabled) { log(`${tag} — Save is disabled (selection didn't register); not saved`, "bad"); await closePanel(panel); continue; }
        save.click();
        let closed = false;
        for (let t = 0; t < 50 && !closed; t++) { await sleep(160); closed = !findLocationPanel(); }
        if (!closed) { log(`${tag} — [SAVE] panel didn't close; please check`, "bad"); continue; }
        // verify the row now shows the chosen location (it may be shortened like "SCR-108-...")
        await sleep(300);
        const after = pickRows(findPickCard() || card)[i];
        const shown = after ? after.label.replace(/[.…\s]+$/, "").toUpperCase() : "";
        const verified = shown && selected.normalized.startsWith(shown.replace(/\s+/g, ""));
        log(`[SAVE] ${verified ? "Success" : "Saved (couldn't confirm on the row)"} — ${selected.normalized}`, verified ? "ok" : "warn");
        ok++;
      }
      log(`[PICKING] Completed ${ok}/${first.length} item(s)`, ok === first.length ? "ok" : "warn");
      step("loc", ok === first.length ? "done" : "bad", `${ok}/${first.length} items`);
    } finally { pickBusy = false; }
  }

  // ---------------- Order status (select-all waits for it) ----------------
  const LS_WAITSTATUS = "shipcubeBot.waitstatus";
  let statusBoxRef = null, statusWaitLogged = null;
  // Find the "Order status" filter: a box whose hint text / label / name says "Order status"
  // (column headers in the order table are ignored).
  function findStatusControl() {
    const skip = (el) => el.closest("#shipcube-bot, th, thead, tr, [role=columnheader], [role=row]");
    const attrHit = (el) => /order[\s_-]*status/i.test([el.getAttribute("placeholder"), el.getAttribute("aria-label"), el.getAttribute("name"),
      el.id, el.getAttribute("data-placeholder"), el.getAttribute("title")].filter(Boolean).join(" "));
    const anchor = [...document.querySelectorAll("input, select, textarea, [role=combobox], [placeholder], [aria-label]")].find((el) => !skip(el) && attrHit(el)) ||
      // a normal dropdown whose options include "Order status"
      [...document.querySelectorAll("select")].find((sel) => !skip(sel) && [...sel.options].some((o) => /order\s*status/i.test(o.text))) ||
      [...document.querySelectorAll("*")].find((el) => !skip(el) && visible(el) && directText(el) === "order status") ||
      // hidden/collapsed text (e.g. inside a custom dropdown button)
      [...document.querySelectorAll("*")].find((el) => !skip(el) && !el.closest("option") && el.childElementCount === 0 && norm(el.textContent) === "order status");
    if (!anchor) return null;
    return anchor.closest('[class*="-container"], [data-ui="Select"], [data-ui*="Select"], [data-ui*="Filter"], .field') ||
      (anchor.parentElement && anchor.parentElement.parentElement) || anchor;
  }
  // what the filter currently shows (dropdown menus and typed search text are ignored)
  function statusSignature(box) {
    const c = box.cloneNode(true);
    c.querySelectorAll('[class*="-menu"], [class*="menu" i], [class*="dropdown" i], [class*="popover" i], [class*="option" i], [role=listbox], [role=option], [role=menu], ul, ol').forEach((n) => n.remove());
    const vals = [...box.querySelectorAll("input:not([role=combobox]), select")].map((i) => i.tagName === "SELECT" ? i.value : i.type === "hidden" ? i.value : i.value).join("|");
    return norm(c.textContent || "") + "#" + vals;
  }
  function otherParams() {
    try { const u = new URL(location.href); [...u.searchParams.keys()].forEach((k) => { if (k === "products" || k === "customer") u.searchParams.delete(k); }); return u.searchParams.toString(); }
    catch { return ""; }
  }
  let statusInitial = null;
  function orderStatusState() {
    let box = findStatusControl();
    if (!box && statusBoxRef && statusBoxRef.isConnected) box = statusBoxRef;
    if (box) statusBoxRef = box;
    const key = pageKey();
    if (!statusInitial || statusInitial.key !== key) statusInitial = { key, sig: box ? statusSignature(box) : null, params: otherParams(), seenBox: !!box };
    if (box && statusInitial.sig === null) { statusInitial.sig = statusSignature(box); statusInitial.seenBox = true; }
    let chosen = false, text = "";
    if (box) {
      const vals = [...box.querySelectorAll('[class*="multiValue"], [class*="singleValue"], [class*="chip" i], [class*="tag" i]')]
        .filter((v) => !v.closest('[class*="-menu"], [class*="menu" i], [class*="dropdown" i], [class*="popover" i], [class*="option" i], [role=listbox], [role=option], [role=menu], ul, ol')).map((v) => (v.innerText || "").trim()).filter(Boolean);
      const sel = box.querySelector("select");
      const plain = [...box.querySelectorAll("input:not([type=hidden]):not([role=combobox])")].map((i) => i.value.trim()).filter(Boolean);
      const hidden = [...box.querySelectorAll("input[type=hidden]")].map((i) => i.value.trim()).filter(Boolean);
      if (vals.length) { chosen = true; text = vals.join(", "); }
      else if (sel && sel.selectedIndex >= 0 && !/^(all|any|select.*|none|-+|order\s*status.*|)$/i.test(norm((sel.options[sel.selectedIndex] || {}).text))) { chosen = true; text = sel.options[sel.selectedIndex].text.trim(); }
      else if (plain.length) { chosen = true; text = plain.join(", "); }
      else if (hidden.length) { chosen = true; text = hidden.join(", "); }
      else if (statusInitial.sig !== null && statusSignature(box) !== statusInitial.sig) {
        chosen = true;
        const c2 = box.cloneNode(true); c2.querySelectorAll('[class*="-menu"], [class*="menu" i], [class*="dropdown" i], [class*="popover" i], [class*="option" i], [role=listbox], [role=option], [role=menu], ul, ol').forEach((n) => n.remove());
        text = norm((c2.textContent || "").replace(/order status/ig, "")) || "changed";
      }
    }
    if (!chosen && otherParams() !== statusInitial.params) { chosen = true; text = text || decodeURIComponent(otherParams()); }
    if (!chosen && !box && statusInitial.seenBox) { chosen = true; text = "changed"; }   // the default "Order status" box was replaced by a value
    return { found: !!box, chosen, text };
  }
  let selectPhaseBusy = false, selectWatchTimer = null;
  window.__shipcubeState = () => ({ running, pickBusy, selectPhaseBusy, guardBusy, selectAllDoneUrl, key: pageKey(),
    status: orderStatusState(), watching: !!selectWatchTimer, header: !!findHeaderCheckbox(), orders: countOrders() });
  // ---- every order status, biggest first ----
  const LS_ROUNDS = "shipcubeBot.statusRounds";
  let roundRemaining = null;
  function cleanPageLink() {   // the suggested-batch link without any filter (so the next round sees every status)
    try { const u = new URL(location.href); const k = new URL(u.origin + u.pathname);
      ["products", "customer"].forEach((n) => { if (u.searchParams.has(n)) k.searchParams.set(n, u.searchParams.get(n)); }); return k.href; }
    catch { return location.href; }
  }
  async function statusOptionsList(box) {
    const bad = (t) => !t || /^(all|any|none|select.*|order\s*status.*|-+|no options)$/i.test(t);
    const sel = box.matches("select") ? box : box.querySelector("select");
    if (sel) return [...sel.options].map((o) => o.text.trim()).filter((t) => !bad(norm(t)));
    const inp = box.querySelector('input[role="combobox"], input');
    const props = inp && findSelectProps(inp);
    if (props && props.options) {
      const l = flatOptions(props.options).map((o) => optionText(o, props.getOptionLabel).trim()).filter((t) => !bad(norm(t)));
      if (l.length) return l;
    }
    // open the menu, read it, close it again
    realClick(box.querySelector('[class*="-control"]') || box); await sleep(700);
    const l = [...new Set([...document.querySelectorAll('[role=option], [class*="-option"], [class*="option" i]')]
      .filter((x) => visible(x) && !x.closest("#shipcube-bot") && x.childElementCount <= 2).map((x) => (x.innerText || "").trim()))].filter((t) => !bad(norm(t)));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (inp) inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await sleep(300);
    return l;
  }
  // count the orders in the list per status (the column whose cells are status names)
  function countByStatus(options) {
    const rows = orderRows() || [];
    const want = new Map(options.map((o) => [norm(o), o]));
    const h = findHeaderCheckbox();
    const heads = h ? [...h.row.querySelectorAll("th, [role=columnheader]")].map((th) => norm(th.innerText)) : [];
    const perCol = {};
    rows.forEach((tr) => [...tr.querySelectorAll("td, [role=cell]")].forEach((td, i) => {
      const t = norm((td.innerText || "").split("\n")[0]);
      if (want.has(t)) perCol[i] = (perCol[i] || 0) + 1;
    }));
    const cols = Object.keys(perCol).map(Number);
    if (!cols.length) return { list: [], unknown: rows.length, col: null };
    const statusHead = cols.find((i) => /status/.test(heads[i] || ""));
    const col = statusHead != null ? statusHead : cols.sort((a, b) => (perCol[b] - perCol[a]) || (b - a))[0];   // most matches, then the right-most (after the method column)
    const counts = new Map(); let unknown = 0;
    rows.forEach((tr) => {
      const td = tr.querySelectorAll("td, [role=cell]")[col];
      const t = td ? norm((td.innerText || "").split("\n")[0]) : "";
      if (want.has(t)) counts.set(want.get(t), (counts.get(want.get(t)) || 0) + 1); else unknown++;
    });
    return { list: [...counts].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n), unknown, col };
  }
  let roundsBusy = false;
  async function pickBiggestStatus() {
    if (roundsBusy || orderStatusState().chosen) return;
    roundsBusy = true;
    try {
      await sleep(600); await settle(1000, 20000);
      await waitForOrders(countOrders());
      if (orderStatusState().chosen) return;
      let total = countOrders();
      if (!total) { await sleep(8000); total = countOrders(); }
      if (!total) {
        log("No orders left on this page — every status is done ✓", "ok"); step("status", "done", "all done");
        const r = await qCall({ op: "done" });
        if (r && r.mine !== undefined && r.running && r.at < r.total) log(`Sheet queue: opening the next batch link (${r.at + 1} of ${r.total})…`, "ok");
        if (getFlag(LS_AUTOCLOSE, false) && await runCountdown("All orders done — closing this tab", 5)) window.postMessage({ __shipcube: "closeTab" }, "*");
        return;
      }
      const box = findStatusControl();
      if (!box) { log("Couldn't find the Order status filter — please choose a status yourself.", "warn"); return; }
      const opts = await statusOptionsList(box);
      const c = countByStatus(opts);
      if (!c.list.length) { log(`Couldn't read the order statuses from the list${opts.length ? "" : " (status names not found)"} — please choose one yourself.`, "warn"); return; }
      log(`Order statuses on this page: ${c.list.map((x) => `${x.label} ${x.n}`).join(", ")}${c.unknown ? ` (+${c.unknown} without a known status)` : ""}`, "ok");
      if (orderStatusState().chosen) return;     // someone chose meanwhile
      const top = c.list[0];
      roundRemaining = total - top.n;
      if (await pickStatus(top.label, `${top.n} orders, the most`)) {
        if (roundRemaining > 0) log(`After this batch: ${roundRemaining} order(s) left in other statuses — the bot reopens this page for the next status.`, "muted");
      } else roundRemaining = null;
    } finally { roundsBusy = false; }
  }
  // pick the company's Order status (if one is set in Settings > Box rules), or the biggest status
  async function autoPickStatus() {
    if (getFlag(LS_ROUNDS, true)) return pickBiggestStatus();
    const cp = companyForPage();
    const want = cp.company && cp.company.status;
    if (!want || orderStatusState().chosen) return;
    return pickStatus(want, cp.company.name);
  }
  async function pickStatus(want, why) {
    const box = findStatusControl();
    if (!box) { log(`Couldn't find the Order status filter to pick “${want}”`, "warn"); return; }
    const sel = box.matches("select") ? box : box.querySelector("select");
    let ok = false;
    if (sel) {
      const o = [...sel.options].find((x) => norm(x.text) === norm(want)) || [...sel.options].find((x) => norm(x.text).includes(norm(want)));
      if (o) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, o.value); sel.dispatchEvent(new Event("change", { bubbles: true })); ok = true; }
    } else {
      const inp = box.querySelector('input[role="combobox"]');
      if (inp) { const r = selectViaReact(inp, want); ok = r.ok; }
      if (!ok) {
        realClick(box.querySelector('[class*="-control"]') || box); await sleep(500);
        const opt = [...document.querySelectorAll('[role=option], li, [class*="option" i]')].find((x) => visible(x) && norm(x.innerText) === norm(want));
        if (opt) { realClick(opt); ok = true; }
      }
    }
    await sleep(600);
    const done = ok && orderStatusState().chosen;
    log(done ? `Order status “${want}” picked (${why}) ✓` : `Couldn't pick Order status “${want}” — please choose it yourself`, done ? "ok" : "warn");
    return done;
  }
  function startSelectionWatch() {
    clearInterval(selectWatchTimer);
    const url = pageKey();
    setTimeout(() => autoPickStatus(), 800);
    selectWatchTimer = setInterval(async () => {
      if (pageKey() !== url) { clearInterval(selectWatchTimer); return; }
      if (selectPhaseBusy || running || pickBusy || !getFlag(LS_SELALL, true) || selectAllDoneUrl === pageKey()) return;
      if (getFlag(LS_WAITSTATUS, true)) {
        const st = orderStatusState();
        if (!st.chosen) {
          if (statusWaitLogged !== url) { statusWaitLogged = url; step("status", "wait", "choose an Order status"); log("Waiting for you to choose an Order status — then the bot selects all orders.", "warn"); }
          return;
        }
        selectPhaseBusy = true;
        step("status", "done", st.text);
        log(`Order status chosen${st.text ? ": " + st.text : ""} — waiting for the list to refresh…`);
      } else selectPhaseBusy = true;
      try {
        const t0 = Date.now();
        await sleep(600); await settle(1000, 15000);
        if (getRows() === "auto" && await setRowsPerPage(false)) { await sleep(800); await settle(1500, 20000); }   // size depends on this status's order count
        await waitForOrders(countOrders());
        if (userTouchedSelect > t0) { selectAllDoneUrl = pageKey(); log("You changed the order selection yourself — leaving it as is."); }
        else {
          await selectAllOrders(false);
          const n = selectedCount(findHeaderCheckbox());
          step("sel", n ? "done" : "bad", n ? n + " selected" : "couldn't confirm");
          if (n) await recordSelection(n);
        }
        if (await inGenQueue()) await autoGenerate();          // only "▶ 1. Generate all" clicks Generate labels
        else log("All done ✓ Check the page, then click Generate labels yourself.", "ok");
      } finally { selectPhaseBusy = false; }
    }, 1500);
  }

  // ---------------- companies & box rules (editable, saved in this browser) ----------------
  const LS_COMPANIES = "shipcubeBot.companies";
  const DEFAULT_COMPANIES = [
    { name: "Kitsch", match: "kitsch", rules: [ { max: 3, box: "6x6x6 Box" }, { max: 11, box: "10x9x4" }, { max: null, box: "12x9x4 Box" } ] },
  ];
  const LS_SEED_DRM = "shipcubeBot.seedDRM";
  const DRM_COMPANY = {"name": "DRMTLGY", "match": "drmtlgy", "onlyPick": true, "rules": [], "products": [{"name": "Universal Tinted Moisturizer SPF 46", "qty": "1", "box": "6x4x3"}, {"name": "Universal Tinted Moisturizer SPF 46", "qty": "2", "box": "9.5x7.5x4"}, {"name": "Needle-less® Serum", "qty": "1", "box": "6x4x3"}, {"name": "Needle-less® Growth Factor Serum", "qty": "1", "box": "6x4x3"}, {"name": "Needle-less® Growth Factor Serum", "qty": "2", "box": "6x4x3"}, {"name": "L.A. Refining Serum", "qty": "1", "box": "Large bubble mailer"}, {"name": "Matte Universal Tinted Moisturizer SPF 46", "qty": "1", "box": "Large bubble mailer"}, {"name": "Pumpkin Enzyme Mask", "qty": "1", "box": "Large bubble mailer"}, {"name": "Peptide Night Cream", "qty": "1", "box": "Small bubble mailer"}, {"name": "Brightening Eye Masks", "qty": "1", "box": "6x4x3"}, {"name": "Luminous Eye Corrector SPF 41 - Fair", "qty": "1", "box": "Small bubble mailer"}, {"name": "Luminous Eye Corrector SPF 41 - Medium", "qty": "1", "box": "Small bubble mailer"}, {"name": "Makeup Minimalist Duo - Medium", "qty": "1", "box": "6x4x3"}, {"name": "Makeup Minimalist Duo - Fair", "qty": "1", "box": "6x4x3"}, {"name": "Vitamin C E + F", "qty": "1", "box": "6x4x3"}, {"name": "TINGL® Exfoliating Pads", "qty": "1", "box": "Large bubble mailer"}, {"name": "Microdermabrasion Scrub", "qty": "1", "box": "Small bubble mailer"}, {"name": "Microdermabrasion Scrub", "qty": "2", "box": "Large bubble mailer"}, {"name": "Advanced Eye Cream", "qty": "1", "box": "Small bubble mailer"}, {"name": "Advanced Eye Cream", "qty": "2", "box": "Large bubble mailer"}, {"name": "Advanced Eye Cream", "qty": "3", "box": "6x4x3"}, {"name": "Essential Cleanser", "qty": "1 to 2", "box": "9.5x7.5x4"}, {"name": "Physical Tinted Moisturizer SPF44", "qty": "1", "box": "Large bubble mailer"}, {"name": "Physical Tinted Moisturizer SPF44", "qty": "2 more", "box": "6x4x3"}, {"name": "Luminous Eye Corrector SPF 41 - Tan", "qty": "1", "box": "Small bubble mailer"}, {"name": "Pre-Cleansing Oil Mini", "qty": "1", "box": "Small bubble mailer"}, {"name": "Pre-Cleansing Oil Mini", "qty": "2 more", "box": "6x4x3"}, {"name": "HPR Eye Cream", "qty": "1", "box": "Large bubble mailer"}, {"name": "SPF 25 Lip Balm", "qty": "1", "box": "Small bubble mailer"}, {"name": "Hydration Booster", "qty": "1 to 2", "box": "Large bubble mailer"}, {"name": "Retinol Body Lotion", "qty": "1", "box": "6x4x3"}, {"name": "Concentrated", "qty": "1", "box": "Large bubble mailer"}, {"name": "Soothe + Recovery Cream", "qty": "1", "box": "Large bubble mailer"}, {"name": "Vitamin C5 - Large Bag", "qty": "1", "box": "Large bubble mailer"}, {"name": "The Best Sellers Bundle Set", "qty": "1", "box": "9.5x7.5x4"}, {"name": "Neutralizing Toner", "qty": "1", "box": "9.5x7.5x4"}, {"name": "Lip Silk SPF 40 Soft", "qty": "1", "box": "Small bubble mailer"}, {"name": "Advanced Neck Cream", "qty": "1", "box": "Large bubble mailer"}, {"name": "Neutralizing Toner", "qty": "1", "box": "9.5x7.5x4"}, {"name": "24 Hour Acne Serum", "qty": "1", "box": "Small bubble mailer"}, {"name": "C Balm", "qty": "1", "box": "Small bubble mailer"}, {"name": "Broad Spectrum SPF 45", "qty": "1", "box": "Large bubble mailer"}, {"name": "Glow Booster Duo", "qty": "1", "box": "9.5x7.5x4"}, {"name": "Water Crème Moisturizer", "qty": "1", "box": "Small bubble mailer"}, {"name": "Gentle Acne Cleanser", "qty": "1", "box": "9.5x7.5x4"}, {"name": "Comprehensive Acne System", "qty": "1", "box": "9.5x7.5x4"}, {"name": "Retinol Complex 0.5%", "qty": "1", "box": "Small bubble mailer"}, {"name": "BHA Toner", "qty": "1", "box": "9.5x7.5x4"}, {"name": "Makeup Primer No. 1", "qty": "1", "box": "Small bubble mailer"}, {"name": "Hydra-Fader", "qty": "1", "box": "Large bubble mailer"}, {"name": "Barrier Repair Mask", "qty": "1", "box": "6x4x3"}, {"name": "Day Dream", "qty": "1", "box": "6x4x3"}, {"name": "Advanced Retexturizer", "qty": "1", "box": "Small bubble mailer"}, {"name": "Shower Oil", "qty": "1", "box": "9.5x7.5x4"}, {"name": "FacialRX™ Brightening Moisturizer", "qty": "1", "box": "6x4x3"}], "ladder": ["small bubble mailer", "large bubble mailer", "6x4x3", "9.5x7.5x4", "11x9x3", "11x9x4"], "fallback": "6x6x6 Box", "alias": {}};
  function loadCompanies() {
    let list = null;
    try { const v = JSON.parse(localStorage.getItem(LS_COMPANIES) || "null"); if (Array.isArray(v)) list = v; } catch {}
    if (!list) list = JSON.parse(JSON.stringify(DEFAULT_COMPANIES));
    // once: add the DRMTLGY product rules (a deleted company stays deleted)
    try {
      if (localStorage.getItem(LS_SEED_DRM) !== "1") {
        if (!list.some((c) => norm(c.name) === "drmtlgy")) { list.push(JSON.parse(JSON.stringify(DRM_COMPANY))); saveCompanies(list); }
        localStorage.setItem(LS_SEED_DRM, "1");
      }
    } catch {}
    try {   // once: DRMTLGY only takes items from ✓ locations
      if (localStorage.getItem("shipcubeBot.drmTick") !== "1") {
        const d = list.find((x) => norm(x.name) === "drmtlgy"); if (d && d.onlyPick === undefined) { d.onlyPick = true; saveCompanies(list); }
        localStorage.setItem("shipcubeBot.drmTick", "1");
      }
    } catch {}
    return list;
  }
  function saveCompanies(list) { try { localStorage.setItem(LS_COMPANIES, JSON.stringify(list)); return true; } catch { return false; } }
  function validateCompanies(list) {
    if (!Array.isArray(list)) return "Not a list of companies";
    for (const c of list) {
      if (!c || !String(c.name || "").trim()) return "Every company needs a name";
      if (!Array.isArray(c.rules)) c.rules = [];
      const hasProducts = Array.isArray(c.products) && c.products.length > 0;
      if (!c.rules.length && !hasProducts) return `${c.name}: add at least one box rule`;
      let last = 0;
      c.rules.forEach((r, i) => { r.box = String(r.box || "").trim(); r.max = r.max === "" || r.max == null ? null : Number(r.max); });
      for (let i = 0; i < c.rules.length; i++) {
        const r = c.rules[i];
        if (!r.box) return `${c.name}: rule ${i + 1} needs a box name`;
        if (r.max === null) { if (i !== c.rules.length - 1) return `${c.name}: only the LAST rule can be "and more"`; continue; }
        if (!Number.isFinite(r.max) || r.max < 1 || Math.floor(r.max) !== r.max) return `${c.name}: rule ${i + 1} "up to" must be a whole number`;
        if (r.max <= last) return `${c.name}: "up to" numbers must go up (rule ${i + 1})`;
        last = r.max;
      }
    }
    return null;
  }
  function companyForPage() {
    const name = norm(customerName());
    const toRules = (c) => (c.rules && c.rules.length ? c.rules.map((r) => ({ maxUnits: r.max == null ? Infinity : r.max, box: r.box })) : null);
    const list = loadCompanies();
    for (const c of list) {
      const key = norm(c.match || c.name);
      if (key && key !== "*" && name.includes(key)) return { name: customerName(), company: c, rules: toRules(c) };
    }
    const fallback = list.find((c) => norm(c.match) === "*");     // "*" = every other company
    if (fallback) return { name: customerName(), company: fallback, rules: toRules(fallback) };
    return { name: customerName(), company: null, rules: null };
  }

  // ---------------- Google Sheet (via a small Apps Script web app) ----------------
  const LS_SHEET = "shipcubeBot.sheet", LS_PENDING = "shipcubeBot.pending", LS_SENTBATCH = "shipcubeBot.sentBatches";
  function sheetCfg() { try { return Object.assign({ on: true, url: "", token: "shipcube" }, JSON.parse(localStorage.getItem(LS_SHEET) || "{}")); } catch { return { on: true, url: "", token: "shipcube" }; } }
  function saveSheetCfg(c) { try { localStorage.setItem(LS_SHEET, JSON.stringify(c)); } catch {} }
  let reqId = 0;
  function sheetCall(payload, second) {
    const cfg = second ? Object.assign({}, sheetCfg(), { url: (sheetCfg().sec || {}).url || sheetCfg().url, token: (sheetCfg().sec || {}).token || sheetCfg().token }) : sheetCfg();
    if (second) payload = Object.assign({ tab: (sheetCfg().sec || {}).tab || "" }, payload);
    if (!cfg.url) return Promise.resolve({ ok: false, error: "No Google Sheet link set (Settings → Google Sheet)" });
    const id = "r" + Date.now() + "_" + (++reqId);
    return new Promise((resolve) => {
      const t = setTimeout(() => { window.removeEventListener("message", on); resolve({ ok: false, error: "No answer from the sheet (timeout) — is the extension reloaded?" }); }, 20000);
      function on(e) {
        if (e.source !== window || !e.data || e.data.__shipcube !== "res" || e.data.id !== id) return;
        clearTimeout(t); window.removeEventListener("message", on); resolve(e.data.res || { ok: false, error: "empty reply" });
      }
      window.addEventListener("message", on);
      window.postMessage({ __shipcube: "req", id, url: cfg.url, body: JSON.stringify(Object.assign({ token: cfg.token }, payload)) }, "*");
    });
  }
  // extra columns for the second sheet: "Heading = field" lines in Settings → Google Sheet (field: order, qty, status, customer, batch, link, date)
  function secExtras(row) {
    const out = {}, src = { order: row.orderNumber, qty: row.qty, status: row.status, customer: row.customer, batch: row.batchId, link: row.batchLink || row.pageLink, date: new Date().toLocaleString() };
    String((sheetCfg().sec || {}).extras || "").split(/\n/).forEach((l) => { const m = l.split("="); if (m.length === 2 && src[m[1].trim().toLowerCase()] != null) out[m[0].trim()] = src[m[1].trim().toLowerCase()]; });
    return out;
  }
  function getPending() { try { return JSON.parse(localStorage.getItem(LS_PENDING) || "[]"); } catch { return []; } }
  function setPending(list) { try { localStorage.setItem(LS_PENDING, JSON.stringify(list.slice(-30))); } catch {} }
  function topOrderForSheet() { const raw = findTopOrderId(); return raw ? raw.replace(/^#/, "") : ""; }
  async function sheetUpsert(row, why) {
    if (!sheetCfg().on) return;
    if (!row.orderNumber && !row.pageLink) { log(`Sheet: no top order number found — row not written (${why})`, "warn"); return; }
    const sec = sheetCfg().sec;
    if (sec && sec.on && (sec.tab || sec.url)) sheetCall({ action: "upsert", row: Object.assign({}, row, { extra: secExtras(row) }) }, true).then((x) => { if (!x.ok) log(`Second sheet ✗ ${x.error || "failed"}`, "bad"); else log(`Second sheet ✓ (row ${x.row})`, "ok"); });
    const r = await sheetCall({ action: "upsert", row });
    step("sheet", r.ok ? "done" : "bad", r.ok ? why : r.error);
    if (r.ok) log(`Sheet ✓ ${why}${r.matched === "link" ? " (your row with this link)" : r.matched === "new" ? " (new row)" : ""}: order ${row.orderNumber}${row.qty != null ? ", qty " + row.qty : ""}${row.status ? ", " + row.status : ""}${row.batchId ? ", batch " + row.batchId : ""}${r.row ? " (row " + r.row + ")" : ""}`, "ok");
    else log(`Sheet ✗ ${why}: ${r.error || "failed"}`, "bad");
    return r;
  }
  // 1) after the bot selects all orders
  async function recordSelection(selected) {
    const row = { orderNumber: topOrderForSheet(), qty: selected, status: orderStatusState().text || "", customer: customerName(), pageLink: cleanPageLink() };
    const list = getPending().filter((p) => p.orderNumber !== row.orderNumber);
    list.push(Object.assign({}, row, { at: Date.now(), remaining: roundRemaining })); setPending(list); setTabPending(Object.assign({}, row, { at: Date.now(), remaining: roundRemaining }));
    await sheetUpsert(row, "orders selected");
  }
  // 2) when someone clicks "Generate labels for N shipments" -> exact qty
  function generateQty(btn) {
    const t = ((btn && btn.innerText) || "").replace(/\s+/g, " ").trim();
    const m = t.match(/for\s+([\d,]+)\s+shipments?/i);
    return m ? parseInt(m[1].replace(/,/g, ""), 10) : (selectedCount(findHeaderCheckbox()) ?? null);
  }
  function recordGenerate(qty, who) {
    const row = { orderNumber: topOrderForSheet(), qty, status: orderStatusState().text || "", customer: customerName(), pageLink: cleanPageLink() };
    const list = getPending().filter((p) => p.orderNumber !== row.orderNumber);
    const prev = getPending().find((p) => p.orderNumber === row.orderNumber) || {};
    list.push(Object.assign({}, row, { at: Date.now(), generatedAt: Date.now(), remaining: roundRemaining != null ? roundRemaining : prev.remaining })); setPending(list);
    { const tp = tabPending(); setTabPending(Object.assign({}, row, { at: Date.now(), generatedAt: Date.now(), remaining: roundRemaining != null ? roundRemaining : (tp && tp.orderNumber === row.orderNumber ? tp.remaining : prev.remaining) })); }
    log(`Generate labels clicked${who ? " " + who : ""} (${qty ?? "?"} shipments) — saved for the sheet`);
    step("gen", "done", (qty ?? "?") + " shipments");
    sheetUpsert(row, "labels generated");
  }
  document.addEventListener("click", (e) => {
    if (!e.isTrusted || !e.target || !e.target.closest) return;
    const btn = e.target.closest("button, [role=button]");
    if (!btn || btn.closest("#shipcube-bot")) return;
    const t = (btn.innerText || "").replace(/\s+/g, " ").trim();
    if (!/generate labels/i.test(t)) return;
    cancelCountdown("you clicked Generate yourself");
    recordGenerate(generateQty(btn), "by you");
  }, true);

  // ---------------- countdown banner (auto-generate / auto-close) ----------------
  let countdown = null;
  function cancelCountdown(why) {
    if (!countdown) return;
    clearInterval(countdown.timer); countdown.el.remove(); countdown.resolve(false);
    log(`${countdown.what} cancelled${why ? " — " + why : ""}`, "warn"); countdown = null;
  }
  function runCountdown(what, seconds) {
    cancelCountdown();
    return new Promise((resolve) => {
      const el = document.createElement("div");
      el.className = "cd";
      el.innerHTML = `<span class="cd-t"></span><button data-a="cdcancel">Cancel</button>`;
      panel.querySelector(".bd").prepend(el);
      let left = seconds;
      const draw = () => { el.querySelector(".cd-t").textContent = `${what} in ${left}s…`; };
      draw();
      const timer = setInterval(() => {
        left--; if (left > 0) return draw();
        clearInterval(timer); el.remove(); countdown = null; resolve(true);
      }, 1000);
      countdown = { what, el, timer, resolve };
      el.querySelector('[data-a="cdcancel"]').onclick = () => cancelCountdown("by you");
    });
  }

  // ---------------- auto-generate labels (optional, off by default) ----------------
  const LS_AUTOGEN = "shipcubeBot.autogen", LS_AUTOCLOSE = "shipcubeBot.autoclose";
  function findGenerateButton() {
    return [...document.querySelectorAll("button, [role=button]")].find((b) => !b.closest("#shipcube-bot") && visible(b) &&
      /generate labels/i.test((b.innerText || "").replace(/\s+/g, " ")));
  }
  // ShipHero's Generate menu items (outside the button itself)
  function findGenerateMenuItems() {
    return [...document.querySelectorAll('[role=menuitem], [role=option], li, button, a, div, span')].filter((el) => !el.closest("#shipcube-bot") && visible(el) &&
      /^generate labels/i.test((el.innerText || "").replace(/\s+/g, " ").trim()) && !/ for \d+|for all/i.test(el.innerText || ""));
  }
  function findGenerateMenuItem(btn) {
    const exact = findGenerateMenuItems().filter((el) => !(btn && btn.contains(el)) && /^generate labels$/i.test((el.innerText || "").replace(/\s+/g, " ").trim()));
    if (!exact.length) return null;
    // the deepest matching element, then its clickable parent (menu item / button / link)
    const leaf = exact.find((el) => !exact.some((o) => o !== el && el.contains(o))) || exact[0];
    return leaf.closest('[role=menuitem], [role=option], li, button, a') || leaf;
  }
  function stepState(k) { const el = panel && panel.querySelector(`[data-step="${k}"]`); return el ? el.className.replace("st", "").trim() : ""; }
  async function autoGenerate(attempt = 1) {
    const qGen = await inGenQueue();
    if (!qGen) return;                                      // never outside "▶ 1. Generate all"
    const h = findHeaderCheckbox(), sel = selectedCount(h), shown = countOrders();
    const btn = findGenerateButton();
    const problems = [];
    if (!sel) problems.push("no orders selected");
    else if (sel < shown) problems.push(`only ${sel} of ${shown} orders selected`);
    if (!btn) problems.push("Generate button not found");
    else { const q = generateQty(btn); if (q != null && sel && q !== sel) problems.push(`button says ${q} shipments but ${sel} are selected`); }
    if (btn && (btn.disabled || btn.getAttribute("aria-disabled") === "true")) problems.push("Generate button is disabled");
    if (stepState("loc") === "bad") problems.push("a picking location wasn't saved");
    if (stepState("box") === "bad") problems.push("the box wasn't set");
    if (problems.length) { step("gen", "bad", problems.join("; ")); log(`Auto-generate stopped: ${problems.join("; ")} — please check and click Generate yourself.`, "bad"); return; }
    step("gen", "wait", "countdown");
    const tl = timingLine(); if (tl) log(tl, "muted");
    const go = await runCountdown(`Generating labels for ${sel} shipments`, qGen ? 1 : 5);
    if (!go) { step("gen", ""); return; }
    const b2 = findGenerateButton();
    if (!b2 || selectedCount(findHeaderCheckbox()) !== sel) {
      if (attempt >= 3) { step("gen", "bad"); log("Auto-generate stopped: the page keeps changing — please check and click Generate yourself.", "bad"); return; }
      log("The page changed during the countdown — waiting for all orders to be selected again…", "warn");
      // the bot re-selects all after ShipHero resets the list; wait until it's complete and steady
      let steady = 0;
      for (let i = 0; i < 60 && steady < 4; i++) {
        await sleep(500);
        const n = selectedCount(findHeaderCheckbox()), shownNow = countOrders();
        steady = n && n === shownNow ? steady + 1 : 0;
      }
      if (steady < 4) { step("gen", "bad"); log("Auto-generate stopped: orders weren't fully selected again — please check.", "bad"); return; }
      return autoGenerate(attempt + 1);
    }
    const qty = generateQty(b2);
    // click the text part of the button (the arrow part may open a menu)
    const leaf = [...b2.querySelectorAll("span, div")].find((x) => x.childElementCount === 0 && /generate labels/i.test(x.textContent || ""));
    (leaf || b2).click();
    // the button opens a menu: Generate labels / Generate labels & invoices / … separately -> only the first one
    let item = null;
    for (let i = 0; i < 16 && !item; i++) { await sleep(250); item = findGenerateMenuItem(b2); if (!item && detectBatchPage()) break; }
    if (item) {
      item.click();
      log("Chose “Generate labels” from ShipHero's menu (not invoices)", "ok");
    } else if (!detectBatchPage() && document.contains(b2) && findGenerateMenuItems().length) {
      step("gen", "bad"); log("Auto-generate: the menu opened but “Generate labels” wasn't found — please choose it yourself.", "bad"); return;
    }
    recordGenerate(qty, "by the bot");
    // ShipHero may ask to confirm - only confirm a dialog that is about labels
    for (let i = 0; i < 16; i++) {
      await sleep(250);
      const dlg = [...document.querySelectorAll('[role=dialog], .modal, [class*="modal" i]')].find((d) => visible(d) && !d.closest("#shipcube-bot") && /label/i.test(d.innerText || ""));
      const ok = dlg && [...dlg.querySelectorAll("button")].find((x) => /^(generate( labels)?|confirm|yes|continue|ok)$/i.test((x.innerText || "").trim()) && !x.disabled);
      if (ok) { ok.click(); log("Confirmed ShipHero's “generate labels” question", "ok"); break; }
      if (detectBatchPage()) break;
    }
  }
  // 3) the "Batch 8055279" screen after generating -> batch id + link
  function detectBatchPage() {
    for (const el of document.querySelectorAll("h1, h2, h3, div, span")) {
      if (el.closest("#shipcube-bot") || !visible(el)) continue;
      const m = directText(el).match(/^batch\s+#?(\d{4,})$/);
      if (m) return m[1];
    }
    return null;
  }
  let batchHandled = null;
  async function handleBatchPage(batchId) {
    if (batchHandled === batchId) return;
    batchHandled = batchId;
    let sent = []; try { sent = JSON.parse(localStorage.getItem(LS_SENTBATCH) || "[]"); } catch {}
    log(`Batch ${batchId} detected`);
    resetSteps(); step("batch", "done", batchId);
    const qs = await qCall({ op: "status" });
    const qmode = qs && qs.ok && qs.running && qs.mine ? qs.mode : null;
    if (qmode !== "gen") startDownloads(batchId);
    if (qmode === "dl") { await passTwo(batchId); return; }
    if (await writeClipboard(batchId)) log(`Batch number ${batchId} copied — use ${batchId}-p / ${batchId}-l for the PDFs`, "ok");
    if (sent.includes(batchId)) { log(`Batch ${batchId} is already in the sheet ✓`, "ok"); step("sheet", "done"); await queueNext(); if (qmode === "gen") closeNow(); else maybeCloseTab(batchId); return; }
    const pageText = document.body.innerText || "";
    const recent = getPending().filter((p) => !p.batchId && Date.now() - p.at < 6 * 3600 * 1000).sort((a, b) => b.at - a.at);
    const tp = tabPending();
    const tpOk = tp && !tp.batchId && Date.now() - tp.at < 6 * 3600 * 1000 ? tp : null;
    // this tab's own selection first (several tabs run at once); the shared list only when this tab has none
    const match = tpOk || recent.find((p) => p.orderNumber && pageText.includes(p.orderNumber)) || (qmode === "gen" ? null : recent[0]);
    if (!match) { log(`Batch ${batchId}: no recent order selection found on this PC — not added to the sheet`, "warn"); return; }
    const row = { orderNumber: match.orderNumber, qty: match.qty, status: match.status, customer: match.customer, pageLink: match.pageLink, batchId, batchLink: location.href };
    const r = await sheetUpsert(row, "batch created");
    if (r && r.ok) {
      setPending(getPending().map((p) => (p.orderNumber === match.orderNumber ? Object.assign(p, { batchId }) : p)));
      if (tpOk) setTabPending(Object.assign({}, tpOk, { batchId }));
      sent.push(batchId); try { localStorage.setItem(LS_SENTBATCH, JSON.stringify(sent.slice(-200))); } catch {}
      if (getFlag(LS_ROUNDS, true) && match.remaining > 0 && match.pageLink) {
        log(`${match.remaining} order(s) left in other statuses — opening the page again for the next status…`, "ok");
        const r = await qCall({ op: "again", url: match.pageLink });
        if (!r.ok) log(`Couldn't reopen the page: ${r.error || "reload the extension"} — open the batch link again yourself.`, "bad");
        else if (r.sameTab) return;          // this tab goes straight on with the next status
      } else await queueNext();
      if (qmode === "gen") closeNow(); else maybeCloseTab(batchId);
    } else if (getFlag(LS_AUTOCLOSE, false)) log("Tab left open because the sheet wasn't updated — please check.", "warn");
  }
  async function closeNow() { await sleep(1500); log("Pass 1: batch saved — closing this tab.", "ok"); window.postMessage({ __shipcube: "closeTab" }, "*"); }
  // Pass 2: labels + packing slip are downloaded by startDownloads; wait for both, then next batch
  async function passTwo(batchId) {
    log(`Pass 2: downloading batch ${batchId}…`);
    const t0 = Date.now();
    let ready = false;
    while (Date.now() - t0 < 25 * 60000) {
      const d = dlDone()[batchId] || {};
      if (d.l && d.p) { await sleep(800); log(`Batch ${batchId}: both PDFs saved ✓`, "ok"); await queueNext(); window.postMessage({ __shipcube: "closeTab" }, "*"); return; }
      const c = pdfControls();
      if (!ready && (d.l || c.l || c.p)) ready = true;
      if (!ready && Date.now() - t0 > 90000) {     // labels still generating -> come back at the end
        log(`Batch ${batchId}: labels aren't ready yet — I'll come back to it at the end.`, "warn");
        await qCall({ op: "done", retry: true });
        window.postMessage({ __shipcube: "closeTab" }, "*"); return;
      }
      await sleep(2000);
    }
    log(`Batch ${batchId}: PDFs not saved after 25 min — moving on.`, "bad");
    await queueNext(); window.postMessage({ __shipcube: "closeTab" }, "*");
  }
  async function queueNext() {
    const r = await qCall({ op: "done" });
    if (r && r.ok && r.running && r.at < r.total) log(`Sheet queue: opening the next batch link (${r.at + 1} of ${r.total})…`, "ok");
    else if (r && r.ok && !r.running && r.total) log("Sheet queue finished ✓", "ok");
  }
  async function maybeCloseTab(batchId) {
    if (!getFlag(LS_AUTOCLOSE, false)) return;
    if (getFlag(LS_AUTODL, true)) {     // wait until labels + packing slip are saved (labels can take a while)
      log("The tab closes after both PDFs are saved…", "muted");
      let ok = false;
      for (let i = 0; i < 60 * 30; i++) { const d = dlDone()[batchId] || {}; if (d.l && d.p) { ok = true; break; } await sleep(2000); }
      if (!ok) { log("PDFs not saved after 60 min — tab left open.", "warn"); return; }
    }
    const go = await runCountdown(`Batch ${batchId} saved — closing this tab`, 5);
    if (!go) return;
    log("Closing tab…");
    window.postMessage({ __shipcube: "closeTab" }, "*");
  }


  // ---------------- PDFs: download + rename to <batch>-l / <batch>-p (into the Label Merger Inbox) ----------------
  const LS_AUTODL = "shipcubeBot.autodl", LS_DLFOLDER = "shipcubeBot.dlfolder", LS_DLDONE = "shipcubeBot.dlDone";
  function dlFolder() { try { const v = localStorage.getItem(LS_DLFOLDER); return v == null ? "LabelMerger/Inbox" : v; } catch { return "LabelMerger/Inbox"; } }
  let dlReq = 0;
  // only one tab at a time may click a download (so the right file gets the right name)
  async function dlLock() { for (let i = 0; i < 150; i++) { const r = await dlCall({ op: "lock" }); if (r.ok && r.granted) return true; await sleep(700); } return false; }
  async function dlUnlock() { await dlCall({ op: "unlock" }); }
  async function dlWaitSaved(batch, kind, maxMs = 45000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const st = await dlCall({ op: "status", batch });
      if ((st.log || []).some((x) => x.kind === kind && (x.state === "complete" || x.state === "interrupted"))) return true;
      await sleep(800);
    }
    return false;
  }
  function dlCall(payload) {
    const id = "d" + Date.now() + "_" + (++dlReq);
    return new Promise((resolve) => {
      const t = setTimeout(() => { window.removeEventListener("message", on); resolve({ ok: false, error: "no answer from the extension" }); }, 15000);
      function on(e) {
        if (e.source !== window || !e.data || e.data.__shipcube !== "dlres" || e.data.id !== id) return;
        clearTimeout(t); window.removeEventListener("message", on); resolve(e.data.res || {});
      }
      window.addEventListener("message", on);
      window.postMessage({ __shipcube: "dl", id, payload }, "*");
    });
  }
  // which PDF does a button/link give?  "l" = labels, "p" = packing slips, null = not a PDF control
  function pdfKind(el) {
    const t = norm([el.innerText, el.getAttribute("aria-label"), el.getAttribute("title"), el.getAttribute("download"), el.getAttribute("href")].filter(Boolean).join(" "));
    if (!t || /generate labels/.test(t) || t.length > 80) return null;
    const pack = /(packing|slip)/.test(t), lab = /\blabels?\b/.test(t);
    if (pack && lab) return null;                       // "labels + packing slips" combined -> skip
    const verb = /(download|print|pdf|open|get|view)/.test(t) || /\.pdf\b/.test(t);
    if (pack && (verb || /^packing slips?$/.test(t))) return "p";
    if (lab && (verb || /^labels?$/.test(t) || /^shipping labels?$/.test(t))) return "l";
    return null;
  }
  function pdfControls() {
    const out = { l: null, p: null };
    for (const el of document.querySelectorAll('a, button, [role=button], [role=menuitem]')) {
      if (el.closest("#shipcube-bot") || !visible(el)) continue;
      const k = pdfKind(el);
      if (k && !out[k]) out[k] = el;
    }
    return out;
  }
  // a click on a labels / packing-slip control (by you or the bot) tells the extension what the next PDF is
  let botClicking = false;
  document.addEventListener("click", (e) => {
    if (botClicking || !detectBatchPage() || !e.target || !e.target.closest) return;
    const el = e.target.closest('a, button, [role=button], [role=menuitem]');
    if (!el || el.closest("#shipcube-bot")) return;
    const k = pdfKind(el);
    if (k) dlCall({ op: "intent", kind: k, batch: detectBatchPage(), folder: dlFolder() });
  }, true);
  function dlDone() { try { return JSON.parse(localStorage.getItem(LS_DLDONE) || "{}"); } catch { return {}; } }
  function markDl(batch, kind) { const d = dlDone(); d[batch] = d[batch] || {}; d[batch][kind] = Date.now(); const keys = Object.keys(d); if (keys.length > 300) delete d[keys[0]]; try { localStorage.setItem(LS_DLDONE, JSON.stringify(d)); } catch {} }
  let dlWatch = null, dlReported = {};
  async function startDownloads(batchId) {
    const arm = await dlCall({ op: "arm", batch: batchId, folder: dlFolder() });
    if (!arm.ok) { log(`PDF renaming not available: ${arm.error || "reload the extension"} `, "bad"); return; }
    const where = dlFolder() ? "Downloads\\" + dlFolder().replace(/\//g, "\\") : "Downloads";
    log(`PDFs from this batch will be saved as ${batchId}-l.pdf (labels) and ${batchId}-p.pdf (packing slips) in ${where}`);
    clearInterval(dlWatch);
    const t0 = Date.now();
    let waitingLogged = false;
    dlWatch = setInterval(async () => {
      if (detectBatchPage() !== batchId || Date.now() - t0 > 60 * 60000) { clearInterval(dlWatch); return; }
      // report finished files
      const st = await dlCall({ op: "status", batch: batchId });
      for (const e of (st.log || [])) {
        const key = e.id + ":" + e.state;
        if (dlReported[key]) continue; dlReported[key] = 1;
        const file = e.file.split("/").pop();
        if (e.state === "complete" && e.mime && !/pdf/i.test(e.mime)) { log(`${file} isn't a PDF (${e.mime}) — please download it yourself and send “Copy debug info” to Claude`, "bad"); continue; }
        if (e.state === "complete") { if (e.kind !== "?") { markDl(batchId, e.kind); } log(e.kind === "?" ? `Saved ${file} — couldn't tell if it's labels or packing slips, please rename it` : `Saved ${file} ✓`, e.kind === "?" ? "warn" : "ok"); }
        else if (e.state === "interrupted") log(`Download of ${file} failed${e.error ? " (" + e.error + ")" : ""}`, "bad");
      }
      const done = dlDone()[batchId] || {};
      step("pdf", done.l && done.p ? "done" : done.l || done.p ? "wait" : "", `${done.l ? "labels ✓ " : ""}${done.p ? "packing ✓" : ""}`);
      if (done.l && done.p) { if (!dlReported.all) { dlReported.all = 1; log(`Both PDFs saved for batch ${batchId} ✓ — Label Merger will merge and upload them`, "ok"); } return; }
      if (!getFlag(LS_AUTODL, true)) return;
      // auto-click the download controls once they show up (labels first, then packing slips)
      const c = pdfControls();
      if (done.l && !done.p && !c.p && !(startDownloads.slip || {})[batchId]) {
        startDownloads.slip = Object.assign(startDownloads.slip || {}, { [batchId]: Date.now() });
        packingSlipFromDashboard(batchId);
        return;
      }
      if (done.l && !done.p && !c.p) {   // dashboard tab is working on it; retry once after 4 minutes
        if (Date.now() - startDownloads.slip[batchId] > 4 * 60000 && !(startDownloads.slipRetry || {})[batchId]) {
          startDownloads.slipRetry = Object.assign(startDownloads.slipRetry || {}, { [batchId]: 1 });
          log("Packing slip not saved yet — trying the dashboard once more…", "warn");
          packingSlipFromDashboard(batchId);
        }
        return;
      }
      if (!c.l && !c.p) { if (!waitingLogged) { waitingLogged = true; log("Waiting for the PDFs to be ready on this page (labels are generated in the cloud — you can also come back later)…", "muted"); } return; }
      for (const k of ["l", "p"]) {
        const el = c[k];
        if (k === "p" && !done.l) continue;        // labels first, then the packing slip
        if (!el || done[k] || (startDownloads.clicked || {})[batchId + k]) continue;
        if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
        startDownloads.clicked = Object.assign(startDownloads.clicked || {}, { [batchId + k]: Date.now() });
        await dlLock();
        const href = el.tagName === "A" && el.getAttribute("href");
        if (href && !/^(#|javascript:)/i.test(href)) {
          const r = await dlCall({ op: "fetch", url: new URL(href, location.href).href, kind: k, batch: batchId, folder: dlFolder() });
          log(r.ok ? `Downloading ${k === "l" ? "labels" : "packing slips"}…` : `Couldn't download ${k === "l" ? "labels" : "packing slips"}: ${r.error}`, r.ok ? "" : "bad");
        } else {
          await dlCall({ op: "intent", kind: k, batch: batchId, folder: dlFolder() });
          botClicking = true; try { el.click(); } finally { botClicking = false; }
          log(`Clicked “${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 40)}” (${k === "l" ? "labels" : "packing slips"})`);
        }
        await dlWaitSaved(batchId, k); await dlUnlock();
        await sleep(300);
        break;     // one at a time so each file gets the right name
      }
    }, 3000);
  }
  // Batch page: click the top order -> side panel "Open on dashboard" -> dashboard tab gets the packing slip
  function findOpenOnDashboard() {
    const el = [...document.querySelectorAll("a, button, [role=button], span, div")].find((x) => !x.closest("#shipcube-bot") && visible(x) &&
      /^open on dashboard$/i.test((x.innerText || "").replace(/\s+/g, " ").trim()));
    return el ? (el.closest("a, button, [role=button]") || el) : null;
  }
  function findBatchTopOrder(batchId) {
    const want = (getPending().find((p) => p.batchId === batchId) || {}).orderNumber || "";
    const cands = [];
    for (const el of document.querySelectorAll("a, button, td, span, div, p")) {
      if (el.closest("#shipcube-bot") || !visible(el)) continue;
      const t = directText(el).replace(/\s+/g, "");
      if (!/^#?\d{6,}$/.test(t) || t.replace("#", "") === batchId) continue;
      const row = el.closest("tr, [role=row]");
      const around = (el.parentElement && el.parentElement.innerText) || "";
      if (/\bsku\b/i.test(around)) continue;                   // item SKUs aren't orders
      if (el.closest('aside, [role=dialog], [class*="drawer" i], [class*="sidebar" i], [class*="side-panel" i]')) continue;
      let score = 0;
      if (want && t.replace("#", "") === want.replace("#", "")) score += 100;
      if (row) score += 20;
      if (el.closest("a, button") || getComputedStyle(el).cursor === "pointer") score += 10;
      if (/^#/.test(t)) score += 5;
      const r = el.getBoundingClientRect();
      cands.push({ el, score, y: r.top + window.scrollY });
    }
    cands.sort((a, b) => b.score - a.score || a.y - b.y);
    return cands.length && cands[0].score >= 10 ? cands[0].el : null;
  }
  async function packingSlipFromDashboard(batchId) {
    await dlCall({ op: "slipset", batch: batchId, folder: dlFolder() });   // the dashboard tab will know which batch it's for
    log("Labels saved ✓ — now the packing slip: opening the top order on the dashboard…");
    let link = findOpenOnDashboard();
    if (!link) {
      const top = findBatchTopOrder(batchId);
      if (!top) { log("Packing slip: couldn't find the top order on this page — click it, then “Open on dashboard” → Packing Slip (the file is renamed automatically).", "warn"); return; }
      top.scrollIntoView({ block: "center" });
      botClicking = true; try { (top.closest("a, button") || top).click(); } finally { botClicking = false; }
      for (let i = 0; i < 40 && !link; i++) { await sleep(250); link = findOpenOnDashboard(); }
    }
    if (!link) { log("Packing slip: “Open on dashboard” didn't appear — click the top order → Open on dashboard → Packing Slip yourself (renamed automatically).", "warn"); return; }
    const href = link.tagName === "A" && link.getAttribute("href");
    if (href && !/^(#|javascript:)/i.test(href)) {
      const r = await dlCall({ op: "slipopen", url: new URL(href, location.href).href });
      log(r.ok ? "Dashboard opened in a background tab — it saves the packing slip and closes itself." : `Couldn't open the dashboard: ${r.error}`, r.ok ? "" : "bad");
    } else {
      botClicking = true; try { link.click(); } finally { botClicking = false; }
      log("Clicked “Open on dashboard” — that tab saves the packing slip and closes itself.");
    }
  }
  // Dashboard order page (app.shiphero.com/dashboard/orders/details/…): only acts when the bot opened it
  const DASH_MATCH = /\/dashboard\/orders\/details\//;
  function isDashboard() { return DASH_MATCH.test(location.pathname); }
  function findPackingSlipButton() {
    const all = [...document.querySelectorAll("a, button, input[type=button], input[type=submit], [role=button]")].filter((el) => !el.closest("#shipcube-bot") && visible(el) &&
      /^packing slips?$/i.test((el.innerText || el.value || "").replace(/\s+/g, " ").trim()));
    // prefer the one in the "Shipments" box
    return all.find((el) => { for (let p = el, i = 0; p && i < 8; p = p.parentElement, i++) if (/^\s*shipments\b/i.test(p.innerText || "")) return true; return false; }) || all[0] || null;
  }
  let dashStarted = false;
  async function handleDashboard() {
    if (dashStarted) return; dashStarted = true;
    const r = await dlCall({ op: "slipget" });
    if (!r.ok || !r.job) return;                 // a normal dashboard visit - the bot does nothing
    const batch = r.job.batch;
    buildPanel(); panel.style.display = "";
    log(`Packing slip for batch ${batch}: looking for the “Packing Slip” button…`);
    const tag = (document.body.innerText || "").match(/bulkship_(\d+)/i);
    if (tag && tag[1] !== batch) log(`Note: this order's tag says bulkship_${tag[1]}, expected ${batch}.`, "warn");
    let btn = null;
    for (let i = 0; i < 120 && !btn; i++) { btn = findPackingSlipButton(); if (!btn) await sleep(500); }
    if (!btn) { log("“Packing Slip” button not found on this page — please click it yourself (the file is renamed automatically).", "bad"); await dlCall({ op: "intent", kind: "p", batch, folder: r.job.folder }); return; }
    btn.scrollIntoView({ block: "center" });
    // the button may open the PDF in a new window: catch that and save it instead
    const origOpen = window.open;
    let caught = null;
    window.open = function (url) {
      if (url && !caught) { try { caught = new URL(String(url), location.href).href; } catch { caught = String(url); } setTimeout(() => { window.open = origOpen; }, 0); return null; }
      return origOpen.apply(window, arguments);
    };
    setTimeout(() => { window.open = origOpen; }, 15000);
    await dlLock();
    await dlCall({ op: "intent", kind: "p", batch, folder: r.job.folder });
    const href = btn.tagName === "A" && btn.getAttribute("href");
    if (href && !/^(#|javascript:)/i.test(href)) caught = new URL(href, location.href).href;
    else btn.click();
    log("Clicked “Packing Slip”");
    for (let i = 0; i < 20 && !caught; i++) await sleep(250);
    if (caught && /^https?:/i.test(caught)) {
      const f = await dlCall({ op: "fetch", url: caught, kind: "p", batch, folder: r.job.folder });
      if (!f.ok) log(`Couldn't download the packing slip: ${f.error}`, "bad");
    }
    // wait until it's saved, then close this tab
    await dlWaitSaved(batch, "p", 30000); await dlUnlock();
    for (let i = 0; i < 90; i++) {
      await sleep(2000);
      const st = await dlCall({ op: "status", batch });
      const e = (st.log || []).find((x) => x.kind === "p" && x.state === "complete");
      if (e) {
        if (e.mime && !/pdf/i.test(e.mime)) { log(`The packing slip came as ${e.mime}, not a PDF — please save it yourself and send “Copy debug info” to Claude.`, "bad"); return; }
        log(`Saved ${e.file.split("/").pop()} ✓ — closing this tab`, "ok");
        await dlCall({ op: "slipdone" });
        await sleep(1500);
        window.postMessage({ __shipcube: "closeTab" }, "*");
        return;
      }
    }
    log(`Packing slip wasn't saved${caught ? " (link: " + caught.slice(0, 100) + ")" : ""} — please save it yourself and send “Copy debug info” to Claude.`, "bad");
  }
  function batchPageDebug() {
    return [...document.querySelectorAll('a, button, [role=button], [role=menuitem]')].filter((el) => !el.closest("#shipcube-bot") && visible(el))
      .map((el) => `${el.tagName}${el.getAttribute("role") ? "[" + el.getAttribute("role") + "]" : ""} "${(el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60)}" aria="${el.getAttribute("aria-label") || ""}" href="${(el.getAttribute("href") || "").slice(0, 120)}" kind=${pdfKind(el) || "-"}`)
      .slice(0, 80).join("\n");
  }


  // ---------------- sheet queue: work through the batch links in the sheet ----------------
  let qReq = 0;
  function qCall(payload) {
    const id = "q" + Date.now() + "_" + (++qReq);
    return new Promise((resolve) => {
      const t = setTimeout(() => { window.removeEventListener("message", on); resolve({ ok: false, error: "no answer from the extension" }); }, 15000);
      function on(e) {
        if (e.source !== window || !e.data || e.data.__shipcube !== "queueres" || e.data.id !== id) return;
        clearTimeout(t); window.removeEventListener("message", on); resolve(e.data.res || {});
      }
      window.addEventListener("message", on);
      window.postMessage({ __shipcube: "queue", id, payload }, "*");
    });
  }
  let curQ = null;
  function showQueue(r) {
    curQ = r;
    const el = panel && panel.querySelector('[data-a="qstat"]');
    if (!el) return;
    if (!r || !r.running) { el.textContent = ""; el.style.display = "none"; return; }
    el.style.display = "";
    el.textContent = (r.mode === "dl" ? "Pass 2 (download) — " : "Pass 1 (generate) — ") + (r.mine ? `Sheet queue: batch ${r.at} of ${r.total}${r.current && r.current.label ? " — " + r.current.label + " (row " + r.current.row + ")" : ""}`
                            : `Sheet queue running: ${r.at} of ${r.total}`);
  }
  async function startQueue(mode) {
    mode = mode === "dl" ? "dl" : "gen";
    if (!sheetCfg().url) { log("Connect the Google Sheet first (⚙ Settings → Google Sheet).", "bad"); return; }
    log(mode === "dl" ? "Pass 2 — reading generated batches without a PDF link from the sheet…" : "Pass 1 — reading the batch links from the sheet…");
    const r = await sheetCall({ action: mode === "dl" ? "queue2" : "queue" });
    if (!r.ok) { log(`Couldn't read the sheet: ${r.error}${/Unknown action/.test(r.error || "") ? " — update the sheet script (new version)" : ""}`, "bad"); return; }
    const items = r.items || [];
    if (!items.length) { log(mode === "dl" ? "Nothing to download — every row with a Batch ID already has a PDF link." : "No batch links to do in the sheet (rows with a ShipHero link and no Batch ID / Order number).", "warn"); return; }
    log(`${items.length} batch(es) to do: ${items.slice(0, 5).map((x) => x.label || "row " + x.row).join(", ")}${items.length > 5 ? " …" : ""}`, "ok");
    if (mode === "gen") {
      if (false) { setFlag(LS_AUTOGEN, true); const g = panel.querySelector('[data-a="autogen"]'); if (g) g.checked = true; log("Auto-generate switched ON for pass 1.", "warn"); }
      if (!loadCompanies().some((c) => c.status)) log("Order status: the bot picks the status with the most orders each round.", "muted");
    } else if (!getFlag(LS_AUTODL, true)) { setFlag(LS_AUTODL, true); const d = panel.querySelector('[data-a="autodl"]'); if (d) d.checked = true; log("Auto-download switched ON for pass 2.", "warn"); }
    showQueue(await qCall({ op: "start", items, mode, conc: mode === "dl" ? (parseInt(localStorage.getItem("shipcubeBot.conc") || "2", 10) || 2) : 1 }));
  }

  // ---------------- team settings (shared file in the bot folder) ----------------
  const LS_TEAMVER = "shipcubeBot.teamVersion";
  const TEAM_KEYS = { companies: LS_COMPANIES, zones: LS_ZONES, sheet: LS_SHEET, rows: LS_ROWS, dlfolder: LS_DLFOLDER };
  function collectTeamSettings() {
    const out = { version: Date.now(), savedAt: new Date().toISOString() };
    for (const [k, ls] of Object.entries(TEAM_KEYS)) {
      try { const v = localStorage.getItem(ls); if (v != null) out[k] = k === "zones" || k === "rows" || k === "dlfolder" ? v : JSON.parse(v); } catch {}
    }
    if (!out.companies) out.companies = loadCompanies();
    if (!out.zones) out.zones = zoneOrder();
    return out;
  }
  function applyTeamSettings(d) {
    if (!d || typeof d !== "object" || !d.version) return;
    let have = 0; try { have = Number(localStorage.getItem(LS_TEAMVER) || 0); } catch {}
    if (Number(d.version) <= have) return;            // already applied (local changes are kept)
    const done = [];
    try {
      if (Array.isArray(d.companies) && !validateCompanies(JSON.parse(JSON.stringify(d.companies)))) { localStorage.setItem(LS_COMPANIES, JSON.stringify(d.companies)); done.push("box rules"); }
      if (typeof d.zones === "string" && d.zones.trim()) { localStorage.setItem(LS_ZONES, d.zones); done.push("location order"); }
      if (d.sheet && typeof d.sheet === "object") { localStorage.setItem(LS_SHEET, JSON.stringify(Object.assign(sheetCfg(), d.sheet))); done.push("Google Sheet"); }
      if (d.rows) { localStorage.setItem(LS_ROWS, String(d.rows)); done.push("rows per page"); }
      if (typeof d.dlfolder === "string") { localStorage.setItem(LS_DLFOLDER, d.dlfolder); done.push("PDF folder"); }
      localStorage.setItem(LS_TEAMVER, String(d.version));
    } catch {}
    if (done.length) log(`Team settings loaded ✓ (${done.join(", ")})`, "ok");
  }
  window.addEventListener("message", (e) => {
    if (e.source === window && e.data && e.data.__shipcube === "team") applyTeamSettings(e.data.data);
  });
  window.postMessage({ __shipcube: "getTeam" }, "*");
  function downloadTeamSettings() {
    const data = collectTeamSettings();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "team-settings.json";
    document.body.appendChild(a); a.click(); a.remove();
    try { localStorage.setItem(LS_TEAMVER, String(data.version)); } catch {}
    log("team-settings.json downloaded — move it into the “ShipCube Bot” folder (see TEAM SETUP.txt)", "ok");
  }

  // ---------------- Settings screen ----------------
  function openSettings() {
    let ov = panel.querySelector(".scb-settings");
    if (ov) { ov.remove(); return; }
    ov = document.createElement("div");
    ov.className = "scb-settings side";
    panel.appendChild(ov);
    // open to the LEFT of the bot panel; on narrow screens use the free width
    const placeSide = () => {
      const r = panel.getBoundingClientRect();
      const room = r.left - 24;
      ov.style.width = Math.max(300, Math.min(440, room)) + "px";
      ov.style.right = (room >= 300 ? window.innerWidth - r.left + 12 : 12) + "px";
    };
    placeSide(); window.addEventListener("resize", placeSide);
    const companies = loadCompanies();
    let tab = "box", prodSel = (() => { const n = (companyForPage().company || {}).name; const i = companies.findIndex((c) => c.name === n); return i >= 0 ? i : Math.max(0, companies.findIndex((c) => (c.products || []).length)); })();
    const boxNames = (() => {
      try {
        const bi = document.querySelector('input[aria-label="Box type selection"]');
        const pr = bi && findSelectProps(bi);
        return pr ? flatOptions(pr.options).map((o) => optionText(o, pr.getOptionLabel)).filter(Boolean) : [];
      } catch { return []; }
    })();
    const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    function render() {
      const cur = companyForPage();
      let h = `<div class="row tabs" style="margin-bottom:8px"><button data-t="box" class="${tab === "box" ? "p" : ""}">Box rules</button><button data-t="prod" class="${tab === "prod" ? "p" : ""}">Products</button><button data-t="loc" class="${tab === "loc" ? "p" : ""}">Locations</button><button data-t="sheet" class="${tab === "sheet" ? "p" : ""}">Google Sheet</button><button data-t="dl" class="${tab === "dl" ? "p" : ""}">PDFs</button><button data-t="team" class="${tab === "team" ? "p" : ""}">Team</button><span style="margin-left:auto;cursor:pointer" data-x="close">✕</span></div>`;
      if (tab === "box") {
        h += `<div style="color:#6B7280;font-size:12px;margin-bottom:6px">This page: <b>${esc(cur.name || "unknown customer")}</b> → ${cur.company ? "uses <b>" + esc(cur.company.name) + "</b> rules" : "no rules (box left as ShipHero chose)"}</div>`;
        h += `<datalist id="scb-boxes">${boxNames.map((b) => `<option value="${esc(b)}">`).join("")}</datalist>`;
        companies.forEach((c, ci) => {
          h += `<div class="scb-co"><div class="row"><input data-c="${ci}" data-f="name" value="${esc(c.name)}" placeholder="Company name" style="flex:1;font-weight:600">
                <button data-delco="${ci}" title="Delete company">🗑</button></div>
                ${(c.products || []).length ? `<div style="font-size:11px;color:#0A2A5E;margin:2px 0">Uses the product rules (Products tab) — the unit rules below are only a backup.</div>` : ""}
                <div class="row" style="font-size:11px;color:#6B7280;margin:4px 0">matches title containing <input data-c="${ci}" data-f="match" value="${esc(c.match || "")}" placeholder="${esc(c.name)}" style="width:110px"></div>
                <label class="row" style="font-size:11px;color:#6B7280;margin:0 0 4px" title="Red X locations are normal locations for most clients. Tick this for clients that only want items from ✓ locations."><input type="checkbox" data-c="${ci}" data-f="onlyPick" ${c.onlyPick ? "checked" : ""}> Only pick from ✓ locations (skip red X)</label>
                <div class="row" style="font-size:11px;color:#6B7280;margin:0 0 4px">Order status to pick <input data-c="${ci}" data-f="status" value="${esc(c.status || "")}" placeholder="empty = you choose" style="width:150px"></div>`;
          c.rules.forEach((r, ri) => {
            h += `<div class="rule">up to <input data-c="${ci}" data-r="${ri}" data-f="max" value="${r.max == null ? "" : r.max}" placeholder="more" style="width:52px"> units →
                  <input data-c="${ci}" data-r="${ri}" data-f="box" value="${esc(r.box)}" list="scb-boxes" placeholder="box name" style="flex:1;min-width:120px"><span class="del" data-delr="${ci}:${ri}" title="remove rule">✕</span></div>`;
          });
          h += `<button data-addr="${ci}" style="font-size:12px;padding:3px 8px">+ rule</button></div>`;
        });
        h += `<div class="row" style="margin-top:8px"><button data-a2="addco">+ Add company</button><button class="p" data-a2="savebox">Save</button>
              <button data-a2="export">Export</button><button data-a2="import">Import</button></div>
              <div style="font-size:11px;color:#64748B;margin-top:4px">Leave the last "up to" empty for "and more". Box names are matched by size (e.g. 10x9x4). Put <b>*</b> in "matches" to use a company's rules for every company that has no rules of its own.</div>
              <textarea data-a2="io" style="display:none;width:100%;height:80px;margin-top:6px;font:11px Consolas"></textarea>`;
      } else if (tab === "prod") {
        if (!companies.length) { h += `<div>Add a company on the Box rules tab first.</div>`; }
        else {
          if (prodSel >= companies.length) prodSel = 0;
          const c = companies[prodSel];
          const text = (c.products || []).map((r) => `${r.name}\t${r.qty}\t${r.box}`).join("\n");
          h += `<div class="row"><b>Product → box rules for</b> <select data-p="co" style="flex:1">${companies.map((x, i) => `<option value="${i}" ${i === prodSel ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
                <div style="font-size:11px;color:#64748B;margin:4px 0">${(c.products || []).length} rule(s). Paste rows straight from Excel: <b>Item Name · Quantity · Box Type</b> (a blank item name = same item as the row above; quantity can be 1, 2, “1 to 2”, “2 more”).</div>
                <textarea data-p="rows" style="width:100%;height:150px;font:11px Consolas" placeholder="Item Name&#9;Quantity&#9;Box Type">${esc(text)}</textarea>
                <div style="margin-top:6px">Box sizes smallest → largest (used to combine several items into one box):</div>
                <input data-p="ladder" value="${esc((c.ladder && c.ladder.length ? c.ladder : DEFAULT_LADDER).join(", "))}" style="width:100%">
                <div style="margin-top:6px">Box to use when no rule matches (or it isn't in ShipHero's list):</div>
                <input data-p="fallback" value="${esc(c.fallback || DEFAULT_FALLBACK_BOX)}" list="scb-boxes" style="width:100%">
                <datalist id="scb-boxes">${boxNames.map((b) => `<option value="${esc(b)}">`).join("")}</datalist>
                <div style="margin-top:6px">ShipHero names for boxes it can't match by size (one per line: <b>workbook name = ShipHero name</b>):</div>
                <textarea data-p="alias" style="width:100%;height:50px;font:11px Consolas" placeholder="small bubble mailer = Poly Mailer S">${esc(Object.entries(c.alias || {}).map(([k, v]) => `${k} = ${v}`).join("\n"))}</textarea>
                <div class="row" style="margin-top:8px"><button class="p" data-a2="saveprod">Save</button><button data-a2="clearprod">Remove all rules</button></div>
                <div style="font-size:11px;color:#64748B;margin-top:4px">Sizes like 6x4x3 are matched by their dimensions. Bubble mailers are matched by words (small / large + bubble). ShipHero's box names on this page: ${boxNames.length ? esc(boxNames.join(", ")) : "(open a batch page to see them)"}.</div>`;
        }
      } else if (tab === "dl") {
        h += `<div><b>Where the PDFs go</b> (a folder inside Chrome's Downloads folder):</div>
              <input data-dl="folder" value="${esc(dlFolder())}" style="width:100%;margin-top:6px" placeholder="LabelMerger/Inbox">
              <div style="font-size:11px;color:#64748B;margin-top:4px">Default <b>LabelMerger/Inbox</b> = Downloads\\LabelMerger\\Inbox (the Label Merger Inbox).<br>
              If Chrome already saves straight into the Inbox, leave this empty.</div>
              <div class="row" style="margin-top:8px"><button class="p" data-a2="savedl">Save</button></div>`;
      } else if (tab === "team") {
        h += `<div><b>Set up once for every PC</b></div>
              <div style="margin-top:4px">1. Set Box rules, Locations and Google Sheet here.<br>2. Click the button below → a <b>team-settings.json</b> file downloads.<br>
              3. Move it into the <b>ShipCube Bot</b> folder and copy that folder to the other PCs (or share it).<br>4. Reload the bot in chrome://extensions — every PC picks the settings up automatically.</div>
              <div class="row" style="margin-top:8px"><button class="p" data-a2="teamdl">Download team settings</button></div>
              <div style="font-size:11px;color:#64748B;margin-top:6px">When you change something later, download the file again and replace it — PCs update on their next page load.</div>`;
      } else if (tab === "loc") {
        h += `<div>Zone priority (first = picked first). Within the same zone the lowest last number wins.</div>
              <textarea data-z="order" style="width:100%;height:60px;margin-top:6px">${esc(zoneOrder())}</textarea>
              <div style="font-size:11px;color:#6B7280">Example: A,B,C,D,E,F,G,H,I,PA,KB — zones not in the list come last. Only green-tick locations with enough stock are used.</div>
              <div class="row" style="margin-top:8px"><button class="p" data-a2="savezones">Save</button><button data-a2="resetzones">Reset to default</button></div>`;
      } else {
        const sc = sheetCfg();
        h += `<label><input type="checkbox" data-s="on" ${sc.on ? "checked" : ""}> Fill the Google Sheet automatically</label>
              <div style="margin-top:6px">Web app link (from the sheet's Apps Script → Deploy):</div>
              <input data-s="url" value="${esc(sc.url)}" placeholder="https://script.google.com/macros/s/…/exec" style="width:100%">
              <div style="margin-top:6px">Password (same as TOKEN in the script):</div>
              <input data-s="token" value="${esc(sc.token)}" style="width:100%">
              <label style="margin-top:10px"><input type="checkbox" data-s="son" ${(sc.sec || {}).on ? "checked" : ""}> Also fill a second sheet</label>
              <div style="font-size:11px;color:#6B7280">Tab name in the same spreadsheet (and/or a different web app link). Leave link/password empty to reuse the ones above.</div>
              <input data-s="stab" value="${esc((sc.sec || {}).tab || "")}" placeholder="Tab name, e.g. Sheet2" style="width:100%;margin-top:4px">
              <input data-s="surl" value="${esc((sc.sec || {}).url || "")}" placeholder="Other web app link (optional)" style="width:100%;margin-top:4px">
              <input data-s="stoken" value="${esc((sc.sec || {}).token || "")}" placeholder="Other password (optional)" style="width:100%;margin-top:4px">
              <div style="margin-top:4px">Extra columns (one per line, “Column heading = field”):</div>
              <textarea data-s="sextra" rows="3" style="width:100%" placeholder="Customer = customer">${esc((sc.sec || {}).extras || "")}</textarea>
              <div class="row" style="margin-top:8px"><button class="p" data-a2="savesheet">Save</button><button data-a2="testsheet">Test connection</button></div>
              <div style="font-size:11px;color:#6B7280;margin-top:6px">Columns filled: Batch link · Batch ID · Qty · Status · Order number. See "GOOGLE SHEET SETUP.txt" in the bot folder.</div>`;
      }
      ov.innerHTML = h;
    }
    function readInputs() {
      ov.querySelectorAll("[data-c]").forEach((inp) => {
        const c = companies[+inp.dataset.c]; if (!c) return;
        if (inp.dataset.r != null) { const r = c.rules[+inp.dataset.r]; if (r) r[inp.dataset.f] = inp.value; }
        else if (inp.type === "checkbox") c[inp.dataset.f] = inp.checked;
        else c[inp.dataset.f] = inp.value;
      });
    }
    ov.addEventListener("change", (e) => { if (e.target.dataset && e.target.dataset.p === "co") { prodSel = +e.target.value; render(); } });
    ov.addEventListener("click", async (e) => {
      const d = e.target.dataset || {};
      if (d.x === "close") { ov.remove(); return; }
      if (d.t) { if (tab === "box") readInputs(); tab = d.t; render(); return; }
      if (tab === "box") readInputs();
      if (d.delco != null) { if (confirmInline(e.target, "Delete?")) { companies.splice(+d.delco, 1); render(); } return; }
      if (d.delr) { const [ci, ri] = d.delr.split(":").map(Number); companies[ci].rules.splice(ri, 1); render(); return; }
      if (d.addr != null) { const c = companies[+d.addr]; const last = c.rules[c.rules.length - 1]; if (last && last.max == null) c.rules.splice(c.rules.length - 1, 0, { max: "", box: "" }); else c.rules.push({ max: "", box: "" }); render(); return; }
      if (d.a2 === "addco") { companies.push({ name: "New company", match: "", rules: [{ max: null, box: "" }] }); render(); return; }
      if (d.a2 === "savebox") {
        const copy = JSON.parse(JSON.stringify(companies));
        copy.forEach((c) => { c.name = String(c.name).trim(); c.match = String(c.match || "").trim().toLowerCase(); c.status = String(c.status || "").trim(); if (!c.status) delete c.status; });
        const err = validateCompanies(copy);
        if (err) { log("Box rules not saved: " + err, "bad"); return; }
        saveCompanies(copy); companies.splice(0, companies.length, ...copy);
        log(`Box rules saved ✓ (${copy.map((c) => c.name).join(", ") || "no companies"})`, "ok"); render(); return;
      }
      if (d.a2 === "export") { const ta = ov.querySelector('[data-a2="io"]'); ta.style.display = ""; ta.value = JSON.stringify(loadCompanies(), null, 1); ta.select(); writeClipboard(ta.value).then((ok) => ok && log("Box rules copied — paste them into Import on another PC", "ok")); return; }
      if (d.a2 === "import") {
        const ta = ov.querySelector('[data-a2="io"]');
        if (ta.style.display === "none" || !ta.value.trim()) { ta.style.display = ""; ta.value = ""; ta.placeholder = "Paste exported box rules here, then click Import again"; ta.focus(); return; }
        try { const v = JSON.parse(ta.value); const err = validateCompanies(v); if (err) throw new Error(err); saveCompanies(v); companies.splice(0, companies.length, ...v); log("Box rules imported ✓", "ok"); render(); }
        catch (er) { log("Import failed: " + er.message, "bad"); }
        return;
      }
      if (d.a2 === "saveprod" || d.a2 === "clearprod") {
        const c = companies[prodSel]; if (!c) return;
        if (d.a2 === "clearprod") { if (!confirmInline(e.target, "Really remove?")) return; c.products = []; saveCompanies(JSON.parse(JSON.stringify(companies))); log(`Product rules removed for ${c.name}`, "ok"); e.target.textContent = "Remove all rules"; render(); return; }
        const q = (k) => ov.querySelector(`[data-p="${k}"]`);
        const { out, errs } = parseProductText(q("rows").value);
        const ladder = q("ladder").value.split(/[,\n]+/).map((x) => x.trim()).filter(Boolean);
        const lad = ladder.map(canonBox);
        const unknown = [...new Set(out.map((r) => canonBox(r.box)).filter((b) => !lad.includes(b)))];
        if (errs.length) { log(`Product rules not saved: ${errs.slice(0, 4).join("; ")}${errs.length > 4 ? " …" : ""}`, "bad"); return; }
        if (out.length && unknown.length) { log(`Product rules not saved: box “${unknown[0]}” isn't in the box-size list (smallest → largest)`, "bad"); return; }
        const alias = {};
        q("alias").value.split(/\r?\n/).forEach((l) => { const m = l.split("="); if (m.length >= 2 && m[0].trim() && m.slice(1).join("=").trim()) alias[canonBox(m[0])] = m.slice(1).join("=").trim(); });
        c.products = out; c.ladder = ladder; c.fallback = q("fallback").value.trim() || DEFAULT_FALLBACK_BOX; c.alias = alias;
        const copy = JSON.parse(JSON.stringify(companies)); const err = validateCompanies(copy);
        if (err) { log("Product rules not saved: " + err, "bad"); return; }
        saveCompanies(copy); log(`Product rules saved ✓ (${c.name}: ${out.length} rule(s), fallback “${c.fallback}”)`, "ok"); render(); return;
      }
      if (d.a2 === "teamdl") { downloadTeamSettings(); return; }
      if (d.a2 === "savedl") { const v = ov.querySelector('[data-dl="folder"]').value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""); try { localStorage.setItem(LS_DLFOLDER, v); } catch {} log(`PDF folder saved ✓ Downloads${v ? "/" + v : ""}`, "ok"); return; }
      if (d.a2 === "savezones" || d.a2 === "resetzones") {
        const v = d.a2 === "resetzones" ? DEFAULT_ZONE_ORDER : ov.querySelector('[data-z="order"]').value.toUpperCase().split(/[\s,>]+/).filter(Boolean).join(",");
        if (!v) { log("Zone priority not saved: the list is empty", "bad"); return; }
        try { localStorage.setItem(LS_ZONES, v); } catch {}
        log(`Location priority saved ✓ ${v.split(",").slice(0, 12).join(" > ")}${v.split(",").length > 12 ? " …" : ""}`, "ok"); render(); return;
      }
      if (d.a2 === "savesheet" || d.a2 === "testsheet") {
        const c = sheetCfg();
        c.on = ov.querySelector('[data-s="on"]').checked; c.url = ov.querySelector('[data-s="url"]').value.trim(); c.token = ov.querySelector('[data-s="token"]').value.trim();
        const q = (k) => ov.querySelector(`[data-s="${k}"]`);
        c.sec = { on: q("son").checked, tab: q("stab").value.trim(), url: q("surl").value.trim(), token: q("stoken").value.trim(), extras: q("sextra").value };
        saveSheetCfg(c);
        if (d.a2 === "savesheet") { log("Google Sheet settings saved ✓", "ok"); return; }
        log("Testing the Google Sheet connection…");
        const r = await sheetCall({ action: "ping" });
        log(r.ok ? `Sheet connected ✓ (tab “${r.sheet}”, columns: ${(r.columns || []).join(", ")})` : `Sheet test failed: ${r.error}`, r.ok ? "ok" : "bad");
      }
    });
    // "Item<TAB>Qty<TAB>Box" lines (as copied from Excel) -> [{name, qty, box}]  (blank item = same as the row above)
    function parseProductText(text) {
      const out = [], errs = []; let last = "";
      String(text || "").split(/\r?\n/).forEach((line, i) => {
        if (!line.trim()) return;
        let p = line.split("\t"); if (p.length < 3) p = line.split(/\s*[|;]\s*/);
        if (p.length < 3) { errs.push(`line ${i + 1}: needs 3 columns (item, quantity, box)`); return; }
        const name = (p[0] || "").replace(/\u00a0/g, " ").trim() || last, qty = (p[1] || "").trim(), box = (p[2] || "").replace(/\u00a0/g, " ").trim();
        if (/^item name$/i.test(name)) return;                       // header row
        if (/^not found$/i.test(name)) return;                       // placeholder rows in the workbook
        if (!name) { errs.push(`line ${i + 1}: no item name`); return; }
        last = name;
        if (!parseQty(qty)) { errs.push(`line ${i + 1}: quantity “${qty}” not understood`); return; }
        if (!box) { errs.push(`line ${i + 1}: no box`); return; }
        out.push({ name, qty, box });
      });
      return { out, errs };
    }
    function confirmInline(el, txt) { if (el.dataset.armed) return true; el.dataset.armed = "1"; el.textContent = txt; setTimeout(() => { delete el.dataset.armed; el.textContent = "🗑"; }, 3000); return false; }
    render();
  }

  // ---------------- main ----------------
  let running = false;
  async function run(manual = false, fromGuard = false) {
    if (running) return;
    if (detectBatchPage()) { if (manual) log("This is a generated batch page — nothing to fill here."); return; }
    running = true;
    try {
      if (!fromGuard) {
        resetSteps();
        const cp = companyForPage(), ce = panel && panel.querySelector('[data-a="cust"]');
        if (ce) ce.innerHTML = `Customer: <b>${(cp.name || "unknown").replace(/</g, "&lt;")}</b> · box rules: <b>${cp.company ? cp.company.name.replace(/</g, "&lt;") : "none"}</b>`;
      }
      if (!fromGuard && sheetCfg().on && !sheetCfg().url) step("sheet", "bad", "Google Sheet not connected");
      if (!fromGuard && sheetCfg().on && !sheetCfg().url) log("Google Sheet is not connected yet — ⚙ Settings → Google Sheet (see GOOGLE SHEET SETUP.txt)", "bad");
      // 1) rows per page
      const rowsChanged = fromGuard ? false : await setRowsPerPage(false);
      if (rowsChanged) { log("Waiting for ShipHero to finish loading the list…"); await sleep(500); await settle(); }
      if (!fromGuard) step("rows", getRows() === "off" ? "skip" : "done");
      // 2) picking locations (once per page)
      if (!fromGuard) await pickLocations(false);
      // 3) Box 1 quantity + box size (box rules per customer)
      const section = findSection();
      if (!section) { if (manual) log("Can't find the “Decide how each order will be packed” section on this page.", "bad"); return; }
      const info = findRows(section);
      if (info.error) { log(info.error, "bad"); return; }
      if (!info.rows.length) { log("No items with an 'Ordered' amount found.", "bad"); return; }

      let total = 0, lastY = 0;
      for (const row of info.rows) {
        total += row.ordered;
        lastY = Math.max(lastY, row.y);
        let ok = await fillQty(section, row, info.boxX);
        if (!ok) { await sleep(1200); const sec2 = findSection(); const inf2 = sec2 && findRows(sec2); const r2 = inf2 && !inf2.error && inf2.rows.find((r) => Math.abs(r.y - row.y) < 30); if (r2) ok = await fillQty(sec2, r2, inf2.boxX); }
        log(ok === "already" ? `Box 1 quantity already ${row.ordered} ✓` : ok ? `Box 1 quantity set to ${row.ordered} (ordered ${row.ordered})`
               : `Couldn't set the Box 1 quantity for a row (ordered ${row.ordered})`, ok ? "ok" : "bad");
      }

      const cust = companyForPage();
      const prodMode = !!(cust.company && Array.isArray(cust.company.products) && cust.company.products.length);
      if (!cust.rules && !prodMode) {
        if (!fromGuard) log(`No box rules for ${cust.name ? "“" + cust.name + "”" : "this customer"} — leaving ShipHero's box as is (add rules in ⚙ Settings).`, "warn");
        if (!fromGuard) { step("box", "skip", "no box rules for this customer"); guardBox(null, null); log("Tasks done. Next: select all orders (after Order status).", "muted"); startSelectionWatch(); }
        return;
      }
      let target, fallbackBox = null;
      if (prodMode) {
        const d = decideProductBox(cust.company, section, info);
        target = d.target; if (d.fallback) fallbackBox = target;
        lastDecision = { company: cust.company.name, lines: d.lines || [], target: d.target };
        if (!fromGuard || d.fallback) log(d.msg, d.cls);
        if (!fallbackBox) fallbackBox = cust.company.fallback || DEFAULT_FALLBACK_BOX;
      } else {
        BOX_RULES = cust.rules;
        target = boxForUnits(total);
        log(`${total} unit(s) in the box → ${cust.company.name} rule says “${target}”`);
      }
      const applyBox = async (tg) => {
        const rs = findReactSelect(info.boxX, lastY);
        if (rs) {
          const r = await selectReactSelect(rs, tg);
          if (r.ok && r.hidden) log(`ShipHero box field now: ${r.hidden}`);
          if (!r.ok && r.msg) log(`Dropdown detail: ${r.msg}`, "warn");
          return r;
        }
        const trigger = findBoxTrigger(section, lastY + 10, info.boxX);
        if (!trigger) return { ok: false, msg: "Couldn't find the box size dropdown.", noDropdown: true };
        return selectBox(section, trigger, tg);
      };
      let res = await applyBox(target);
      if (res.noDropdown) { log(res.msg, "bad"); return; }
      // the workbook's box isn't in ShipHero's list -> the fallback box (6x6x6)
      if (!res.ok && prodMode && fallbackBox && canonBox(target) !== canonBox(fallbackBox) && /not in the list|no matching|didn't open|not found/i.test(res.msg || "")) {
        log(`“${target}” isn't in ShipHero's box list → using “${fallbackBox}” instead`, "warn");
        target = fallbackBox;
        res = await applyBox(target);
      }
      // final safety check: never leave a wrong box silently
      await sleep(300);
      {
        const sec2 = findSection(), inf2 = sec2 && findRows(sec2);
        const rs2 = inf2 && !inf2.error && inf2.rows.length && findReactSelect(inf2.boxX, Math.max(...inf2.rows.map((r) => r.y)));
        const cur = rs2 ? rs2.current() : "";
        if (cur && pickOption([{ innerText: cur, textContent: cur }], target) === null) {
          res = { ok: false, msg: `box is “${cur}” but the rule says “${target}” — please pick it by hand` };
        }
      }
      if (res.ok) guardBox(target, res.chosen);
      step("box", res.ok ? "done" : "bad", res.ok ? res.chosen : res.msg);
      if (res.ok) log(res.already ? `Box already set to “${res.chosen}” ✓` : `Box selected: “${res.chosen}” ✓`, "ok");
      else log(`Box not selected: ${res.msg}`, "bad");
      // 4) select all orders comes LAST (after Order status is chosen)
      if (!fromGuard) { log("Tasks done. Next: select all orders (after Order status).", "muted"); startSelectionWatch(); }
    } catch (e) {
      log("Error: " + (e && e.message), "bad");
    } finally {
      running = false;
    }
  }

  function copyDebug() {
    const section = findSection();
    const root = section || document.body;
    const clone = root.cloneNode(true);
    clone.querySelectorAll("svg,img,style,script,#shipcube-bot").forEach((n) => n.remove());
    let html = clone.outerHTML.replace(/\s(style|d|srcset)="[^"]*"/g, "").replace(/\s{2,}/g, " ");
    const opts = visibleOptions(document.createElement("div")).map((o) => o.outerHTML.slice(0, 300));
    let around = "";
    try {
      const info = section && findRows(section);
      if (info && info.boxHdr) {
        let box = info.boxHdr; for (let i = 0; i < 6 && box.parentElement; i++) box = box.parentElement;
        const c2 = box.cloneNode(true); c2.querySelectorAll("svg,img,style,script").forEach((n) => n.remove());
        around = c2.outerHTML.replace(/\s(style|d)="[^"]*"/g, "").slice(0, 20000);
      }
    } catch (e) { around = "error: " + e.message; }
    let rowsHtml = "", propsInfo = "";
    try {
      const lbl = [...document.querySelectorAll("*")].find((el) => directText(el) === "rows per page");
      if (lbl) { let b = lbl; for (let i = 0; i < 4 && b.parentElement; i++) b = b.parentElement; rowsHtml = b.outerHTML.replace(/\s(style|d)="[^"]*"/g, "").slice(0, 6000); }
      const bi = document.querySelector('input[aria-label="Box type selection"]');
      const pr = bi && findSelectProps(bi);
      if (bi && pr) {
        const lab = (o) => optionText(o, pr.getOptionLabel);
        const labels = flatOptions(pr.options).map(lab);
        propsInfo = `react props found, ${labels.length} options, getOptionLabel: ${!!pr.getOptionLabel}\nfirst labels: ${labels.slice(0, 8).join(" | ")}\nhas "6x6x6 Box": ${labels.some((l) => norm(l) === "6x6x6 box")}\nsample option keys: ${Object.keys(flatOptions(pr.options)[0] || {}).join(",")}`;
      } else propsInfo = bi ? "react props NOT found (fiber: " + !!fiberOf(bi) + ")" : "box input not found";
    } catch (e) { propsInfo = "error " + e.message; }
    try { const hc = findHeaderCheckbox(); rowsHtml += "\n\n--- SELECT-ALL ROW ---\n" + (hc ? hc.row.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, "").slice(0, 4000) : "not found"); } catch {}
    try {
      const st = orderStatusState(), pc = findPickCard();
      rowsHtml += `\n\n--- CUSTOMER ---\n${customerName() || "(not found)"}\n\n--- ORDER STATUS ---\nfound=${st.found} chosen=${st.chosen} text=${st.text}\n${statusBoxRef && statusBoxRef.isConnected ? statusBoxRef.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, "").slice(0, 3000) : ""}`;
      const anchor = document.querySelector('input[placeholder*="search by order" i]') ||
        [...document.querySelectorAll("*")].find((el) => /^carrier\s*&\s*methods$/i.test(directText(el)));
      let fr = anchor; for (let i = 0; i < 5 && fr && fr.parentElement; i++) { fr = fr.parentElement; if (/order status/i.test(fr.textContent || "") || fr.querySelectorAll("select, input, [role=combobox]").length >= 3) break; }
      rowsHtml += "\n\n--- FILTERS ROW ---\n" + (fr ? fr.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, "").slice(0, 8000) : "not found");
      rowsHtml += "\n\n--- ORDER TABLE ---\nrows=" + countOrders() + " top=" + findTopOrderId() + " col=" + orderColIdx;
      rowsHtml += "\n\n--- PICK ITEMS ---\n" + (pc ? pc.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, "").slice(0, 12000) : "not found");
      rowsHtml += "\n\n--- LAST LOCATION PANEL ---\n" + (lastPanelHtml || "(not opened yet)");
    } catch (e) { rowsHtml += "\n(debug error " + e.message + ")"; }
    try { if (detectBatchPage() || isDashboard()) rowsHtml += "\n\n--- BATCH PAGE BUTTONS/LINKS ---\n" + batchPageDebug(); } catch {}
    const panelLog = logEl ? [...logEl.children].map((d) => d.textContent).slice(-40).join("\n") : "";
    const out = `Bot version: ${VERSION}\nBox dropdown: ${propsInfo}\n\n--- BOT LOG ---\n${panelLog}\n\n--- ROWS PER PAGE ---\n${rowsHtml}\n\nURL: ${location.href}\nSection found: ${!!section}\n\n--- OPEN DROPDOWN OPTIONS ---\n${opts.join("\n")}\n\n--- AROUND BOX 1 ---\n${around}\n\n--- SECTION HTML ---\n${html.slice(0, 60000)}`;
    try { rtCall({ type: "pdebug", text: out }, 5000); } catch {}   // the side panel copies it
    navigator.clipboard.writeText(out).then(
      () => log("Debug info copied. Paste it into a .txt file and send it to Claude.", "ok"),
      () => { console.log(out); log("Couldn't copy - info printed in the console (F12).", "warn"); });
  }

  // a suggested-batch page with no orders at all (everything already generated)
  let emptyChecked = null;
  function scheduleEmptyCheck() {
    const key = pageKey();
    if (emptyChecked === key) return; emptyChecked = key;
    setTimeout(async () => {
      if (pageKey() !== key || lastRunUrl === key || detectBatchPage() || countOrders() > 0) return;
      log("No orders on this page — every status is done ✓", "ok");
      const r = await qCall({ op: "done" });
      if (getFlag(LS_AUTOCLOSE, false) && r && r.ok && r.total) { if (await runCountdown("All orders done — closing this tab", 5)) window.postMessage({ __shipcube: "closeTab" }, "*"); }
    }, 30000);
  }
  // ---------------- v2: relay to the background (Single Orders jobs, bot clock, queue status) ----------------
  let rtReq = 0;
  function rtCall(payload, timeout = 20000) {
    const id = "rt" + Date.now() + "_" + (++rtReq);
    return new Promise((resolve) => {
      const t = setTimeout(() => { window.removeEventListener("message", on); resolve({ ok: false, error: "no answer from the extension" }); }, timeout);
      function on(e) {
        if (e.source !== window || !e.data || e.data.__shipcube !== "rtres" || e.data.id !== id) return;
        clearTimeout(t); window.removeEventListener("message", on); resolve(e.data.res || {});
      }
      window.addEventListener("message", on);
      window.postMessage({ __shipcube: "rt", id, payload }, "*");
    });
  }
  // ---- Bulk Ship stays separate: it only works when "Bulk Ship automation" is ON (side panel), or in a queue tab ----
  const LS_BULKON = "shipcubeBot.bulkOn";
  let queueMine = false;
  async function refreshQueueMine() { const q = await qCall({ op: "status" }); queueMine = !!(q && q.ok && q.running && q.mine); return queueMine; }
  function bulkAllowed() { return queueMine || getFlag(LS_BULKON, false); }
  async function inGenQueue() { const q = await qCall({ op: "status" }); return !!(q && q.ok && q.running && q.mine && q.mode === "gen"); }
  const LS_TABPEND = "shipcubeBot.tabPending";   // sessionStorage = this tab only
  function tabPending() { try { return JSON.parse(sessionStorage.getItem(LS_TABPEND) || "null"); } catch { return null; } }
  function setTabPending(p) { try { sessionStorage.setItem(LS_TABPEND, JSON.stringify(p)); } catch {} }

  // =====================================================================================
  //  SINGLE ORDERS worker: only in tabs the side panel opened for a sheet row
  //  search order -> open it -> click every item on the left (moves it into the package)
  //  -> box by total qty -> Complete order -> the background writes "Completed" in the sheet
  // =====================================================================================
  let soMode = false, soSent = false, soChipEl = null;
  const soKey = (s) => String(s == null ? "" : s).replace(/\s+/g, "").replace(/^#+/, "").toUpperCase();
  // what to type in ShipHero's search: 577… marketplace numbers have no "#", our own numbers exactly ONE "#"
  function searchTerm(order) {
    const raw = String(order || "").trim(), t = raw.replace(/^#+\s*/, "");
    if (/^577\d+$/.test(t)) return t;
    if (/^\d+$/.test(t) || /^#/.test(raw)) return "#" + t;
    return t;                                            // e.g. EXC-13833842-1
  }
  async function waitFor(fn, ms, every = 250) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(every); } return fn() || null; }
  function soChip(text, bad) {
    if (!soChipEl) {
      soChipEl = document.createElement("div");
      soChipEl.id = "shipcube-so";
      soChipEl.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;align-items:center;gap:8px;max-width:420px;background:#2D6CDF;color:#fff;font:600 12.5px 'Segoe UI',system-ui,sans-serif;padding:7px 12px;border-radius:6px;box-shadow:0 6px 18px rgba(31,42,68,.25);border:2px solid #2D6CDF;line-height:1.3;pointer-events:none";
      document.body.appendChild(soChipEl);
    }
    soChipEl.style.borderColor = bad ? "#E8473D" : "#2D6CDF"; soChipEl.style.background = bad ? "#E8473D" : "#2D6CDF";
    soChipEl.textContent = "ShipCube · " + text;
    console.log("[ShipCube Single Orders]", text);
  }
  async function soDone(res) {
    if (soSent) return; soSent = true;
    soChip(res.ok ? (res.already ? "already fulfilled ✓" : res.dry ? `dry run ok — ${res.box}` : `completed ✓ ${res.box}`) : `✗ ${res.msg}`, !res.ok);
    await rtCall({ type: "so", op: "result", res });
  }
  const soStage = (stage, text) => { soChip(text || stage); rtCall({ type: "so", op: "beat", stage }); };

  async function soBoot() {
    if (!/(^|\.)shipping\.shiphero\.com$/.test(location.hostname)) return;
    let r = await rtCall({ type: "so", op: "job" }, 8000);
    if (r && r.ok && !r.job && /^\/orders\/(ship\/)?$/.test(location.pathname)) { await new Promise((x) => setTimeout(x, 1500)); r = await rtCall({ type: "so", op: "job" }, 8000); }   // a brand-new bot tab: its job may land a moment later
    if (!r || !r.ok || !r.job) return;
    soMode = true;
    if (panel) panel.style.display = "none";
    const job = r.job, it = job.item;
    soChip(`tab ${job.n || "?"} · row ${it.row} · ${it.order || it.id}`);
    const hb = setInterval(() => rtCall({ type: "so", op: "beat" }), 10000);
    try {
      if (/\/orders\/ship\//.test(location.pathname)) await soPack(job);
      else if (/^\/orders\/?$/.test(location.pathname)) await soSearch(job);
      else { location.href = "https://shipping.shiphero.com/orders/"; return; }
    } catch (e) {
      await soDone({ ok: false, retry: true, msg: "bot error: " + (e && e.message) });
    } finally { clearInterval(hb); }
  }

  // 1) Single Orders page: type the order number in the search box, click the order
  async function soSearch(job) {
    const it = job.item;
    if (!it.order || it.sci) return soDone({ ok: false, msg: "no usable Order Number to search for" });
    await rtCall({ type: "so", op: "via", via: "search" });
    soStage("search", `searching ${it.order}…`);
    const input = await waitFor(() => [...document.querySelectorAll("input")].find((i) => visible(i) && !i.closest("#shipcube-bot") &&
      /^(text|search|)$/i.test(i.getAttribute("type") || "") && i.getBoundingClientRect().top < 420), 20000);
    if (!input) return soDone({ ok: false, retry: true, msg: "Single Orders search box not found" });
    const want = soKey(it.order);
    const findCell = () => [...document.querySelectorAll("a, td, span, div, p")].find((el) => !el.closest("#shipcube-bot, #shipcube-so") && visible(el) &&
      el.childElementCount === 0 && soKey(el.textContent) === want && el.getBoundingClientRect().top > input.getBoundingClientRect().bottom);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    input.focus(); setter.call(input, searchTerm(it.order));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    ["keydown", "keypress", "keyup"].forEach((k) => input.dispatchEvent(new KeyboardEvent(k, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })));
    // the list refreshes: wait until it shows only our order
    const noMatch = () => /no orders match your query/i.test(document.body.innerText || "");
    let cell = await waitFor(() => { if (noMatch()) return "none"; const c = findCell(); const rows = document.querySelectorAll("tbody tr, [role=row]").length; return c && rows <= 3 ? c : null; }, 15000);
    if (cell === "none") { await sleep(1500); cell = noMatch() ? "none" : findCell(); }
    // ShipHero's Single Orders only lists orders still to ship: "No orders match" = already fulfilled
    if (cell === "none") return soDone({ ok: true, already: true, msg: "already fulfilled in ShipHero" });
    if (!cell) cell = findCell();
    if (!cell) return soDone({ ok: false, msg: `order ${it.order} not found on Single Orders (already shipped or wrong number?)` });
    const resRow = cell.closest && cell.closest("tr, [role=row]");
    if (resRow && /\bbulk[\s_-]*ship/i.test(resRow.innerText || "")) return soDone({ ok: false, msg: "bulk ship" });
    soStage("open", `opening ${it.order}…`);
    const target = cell.closest("a") || cell;
    realClick(target); if (target.tagName === "A") target.click();
    const opened = await waitFor(() => /\/orders\/ship\//.test(location.pathname), 15000);
    if (!opened) { const row = cell.closest("tr, [role=row]"); if (row) { realClick(row); await waitFor(() => /\/orders\/ship\//.test(location.pathname), 10000); } }
    if (!/\/orders\/ship\//.test(location.pathname)) return soDone({ ok: false, retry: true, msg: "clicking the order didn't open it" });
    return soPack(job);   // same page (ShipHero changes the address without reloading)
  }

  // ---- packing page helpers ----
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
  function soBoundary() {   // x where the right half ("Shipping details") starts
    const sd = [...document.querySelectorAll("h1,h2,h3,h4,div,span,p")].find((el) => visible(el) && /^shipping details$/i.test(ownText(el)));
    return sd ? sd.getBoundingClientRect().left - 25 : window.innerWidth * 0.52;
  }
  function skuLeaves() {
    return [...document.querySelectorAll("div, span, p, small, td")].filter((el) => !el.closest("#shipcube-bot, #shipcube-so") && visible(el) && /^sku\b/i.test(ownText(el)));
  }
  function rowQty(leaf, all) {   // the plain number to the right of an item (its quantity)
    const lr = leaf.getBoundingClientRect();
    let p = leaf;
    for (let i = 0; i < 8 && p.parentElement; i++) {
      p = p.parentElement;
      if (all.filter((x) => x !== leaf && p.contains(x)).length) return null;      // reached another item
      const nums = [...p.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && visible(e) && /^\d+$/.test((e.textContent || "").trim()) && e.getBoundingClientRect().left > lr.right + 60);
      if (nums.length) return parseInt(nums[nums.length - 1].textContent.trim(), 10);
    }
    return null;
  }
  function soSides() {
    const b = soBoundary(), all = skuLeaves();
    const left = all.filter((l) => l.getBoundingClientRect().left < b), right = all.filter((l) => l.getBoundingClientRect().left >= b);
    const rq = right.map((l) => rowQty(l, all));
    return { left, right, rightUnits: rq.reduce((a, n) => a + (n || 0), 0), rightUnknown: rq.some((n) => n == null) };
  }
  function packages() {
    return [...document.querySelectorAll("div, span, p, button")].filter((el) => visible(el) && /^package\s*\d+$/i.test(ownText(el)) && !el.closest("#shipcube-so"));
  }
  function packageBadge(pkg) {
    if (!pkg) return null;
    const m = (pkg.parentElement && pkg.parentElement.innerText || "").replace(/\s+/g, " ").match(/package\s*\d+\s*(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
  }
  function bulkShipFlag(root) {
    const els = [...(root || document).querySelectorAll("div, span, p, h1, h2, h3, h4, h5, li, td, label, small, strong, b, a")];
    const hit = els.find((el) => el.childElementCount === 0 && visible(el) && /\bbulk[\s_-]*ship/i.test(el.textContent || "") &&
      !el.closest('nav, aside, header, [class*="sidebar" i], [class*="side-bar" i], [class*="menu" i], [class*="navigation" i], #shipcube-bot, #shipcube-so') &&
      !(el.closest("a") && /bulk-ship/i.test(el.closest("a").getAttribute("href") || "")));
    return hit ? (hit.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80) : "";
  }
  // ShipHero pop-up like "Order 854475386 is on hold" with Show details + Exit Order:
  // click Show details, read the text under it, click Exit Order, return the details
  function detailsModal() {
    return [...document.querySelectorAll('[role=dialog], [role=alertdialog], .modal, [class*="modal" i], [class*="dialog" i]')]
      .filter((d) => visible(d) && !d.closest("#shipcube-bot, #shipcube-so"))
      .find((d) => [...d.querySelectorAll("button, a, [role=button]")].some((b) => /^exit order$/i.test((b.innerText || "").trim())) ||
                   /\b(show|hide) details\b/i.test(d.innerText || "")) || null;
  }
  async function readDetailsModal(d) {
    const link = [...d.querySelectorAll("a, button, span, div, p, [role=button]")].find((x) => x.childElementCount === 0 && /^show details$/i.test((x.textContent || "").trim()));
    if (link) {                                   // ONE click (a second one would close the details again)
      if (typeof link.click === "function") link.click(); else realClick(link);
      let shown = await waitFor(() => /hide details/i.test(d.innerText || ""), 2500, 150);
      if (!shown && /show details/i.test(d.innerText || "")) { realClick(link); shown = await waitFor(() => /hide details/i.test(d.innerText || ""), 2500, 150); }
      await sleep(300);
    }
    const lines = (d.innerText || "").split(/\n+/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
    const at = lines.findIndex((x) => /^(hide|show) details$/i.test(x));
    let det = (at >= 0 ? lines.slice(at + 1) : []).filter((x) => !/^(exit order|close|ok|cancel)$/i.test(x)).join(" ").trim();
    if (!det) det = lines.find((x) => !/^(exit order|close|ok|cancel|show details|hide details)$/i.test(x)) || "ShipHero error";   // the title, e.g. "Order … is on hold"
    const exit = [...d.querySelectorAll("button, a, [role=button]")].find((b) => /^exit order$/i.test((b.innerText || "").trim()));
    if (exit) { await sleep(200); exit.click(); }    // leave the order so it isn't kept open
    return det.slice(0, 200);
  }
  function completeBtn() {
    return [...document.querySelectorAll("button, [role=button]")].find((b) => !b.closest("#shipcube-bot, #shipcube-so") && visible(b) && /^complete order$/i.test((b.innerText || "").replace(/\s+/g, " ").trim()));
  }
  function popupText(re) {
    const els = [...document.querySelectorAll('[role=alert], [role=status], [class*="toast" i], [class*="notif" i], [class*="snackbar" i], [class*="alert" i], [class*="message" i]')]
      .filter((e) => visible(e) && !e.closest("#shipcube-bot, #shipcube-so"));
    const hit = els.find((e) => re.test(e.innerText || ""));
    return hit ? (hit.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160) : "";
  }
  function openDialog() {
    const d = [...document.querySelectorAll('[role=dialog], [role=alertdialog], .modal, [class*="modal" i], [role=menu]')].find((x) => visible(x) && !x.closest("#shipcube-bot, #shipcube-so") && (x.innerText || "").trim());
    return d ? (d.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160) : "";
  }
  function soBoxFor(units, rulesText) {
    const rules = String(rulesText || "").split(/\n/).map((l) => l.split("=")).filter((x) => x.length === 2)
      .map(([a, b]) => ({ max: /^\s*\*\s*$/.test(a) ? Infinity : parseInt(a, 10), box: b.trim() })).filter((r) => r.box && (r.max === Infinity || r.max > 0)).sort((a, b) => a.max - b.max);
    const r = rules.find((x) => units <= x.max);
    return r ? r.box : null;
  }
  function boxControl() {
    const lbl = [...document.querySelectorAll("div, span, label, p")].find((el) => visible(el) && /^shipping box$/i.test(ownText(el)) && !el.closest("#shipcube-so"));
    if (!lbl) return null;
    let p = lbl;
    for (let i = 0; i < 6 && p.parentElement; i++) {
      p = p.parentElement;
      const inp = p.querySelector('input[role="combobox"], input[aria-autocomplete], select');
      const ctl = p.querySelector('[class*="-control"], [class*="select" i]');
      if (inp || ctl) return { root: p, inp, ctl: (inp && inp.closest('[class*="-control"]')) || ctl || inp };
    }
    return null;
  }
  function boxShown(bc) {
    if (!bc) return "";
    if (bc.inp && bc.inp.tagName === "SELECT") return bc.inp.options[bc.inp.selectedIndex] ? bc.inp.options[bc.inp.selectedIndex].text : "";
    const sv = bc.root.querySelector('[class*="singleValue"], [class*="single-value"]');
    return ((sv || bc.ctl || {}).innerText || "").replace(/\s+/g, " ").trim();
  }
  const sameBox = (a, b) => !!a && !!b && (canonBox(a) === canonBox(b) || (dims(a) && dims(a) === dims(b)));

  // choose the box patiently (up to ~15 s): React value first; else open the list (that loads the boxes) and click the option.
  // Works in small / minimised windows too (doesn't need the list to be on screen).
  async function chooseBox(box) {
    let seen = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      const bc = boxControl();
      if (!bc) { await sleep(600); continue; }
      if (sameBox(boxShown(bc), box)) return { ok: true };
      if (bc.inp && bc.inp.tagName === "SELECT") {
        const o = [...bc.inp.options].find((x) => sameBox(x.text, box));
        if (o) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(bc.inp, o.value); bc.inp.dispatchEvent(new Event("change", { bubbles: true })); }
        else seen = [...bc.inp.options].map((x) => x.text);
      } else if (bc.inp) {
        const r = selectViaReact(bc.inp, box);
        if (!r.ok && /has: (.+)\)$/.test(r.msg || "")) seen = RegExp.$1.split(", ").filter(Boolean);
      }
      await sleep(400 + attempt * 100);
      if (sameBox(boxShown(boxControl()), box)) return { ok: true };
      // open the list: mouse down on the control + ArrowDown (loads the options), then click the right one
      const b2 = boxControl(); if (!b2) continue;
      const ctl = b2.ctl || b2.root;
      ["pointerdown", "mousedown"].forEach((t) => ctl.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, button: 0 })));
      if (b2.inp && b2.inp.tagName !== "SELECT") { try { b2.inp.focus(); } catch {} b2.inp.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true })); }
      await sleep(500 + attempt * 150);
      const opts = [...document.querySelectorAll('[role=option], [class*="-option"]')].filter((o) => (o.textContent || "").trim() && !o.closest("#shipcube-so, #shipcube-bot"));
      if (opts.length) seen = opts.map((o) => (o.textContent || "").trim());
      const hit = pickOption(opts, box);
      if (hit) { hit.scrollIntoView({ block: "nearest" }); realClick(hit); await sleep(600); if (sameBox(boxShown(boxControl()), box)) return { ok: true }; }
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await sleep(300);
    }
    // only call it "not in the list" when the list really loaded and the box isn't there
    const notInList = seen.length >= 3 && !seen.some((x) => sameBox(x, box));
    return { ok: false, notInList, seen };
  }
  // 2) packing page
  async function soPack(job) {
    const it = job.item;
    soStage("load", `row ${it.row} · loading order…`);
    const findHead = () => [...document.querySelectorAll("h1, h2, h3, div, span")].find((el) => visible(el) && /^order\s*#/i.test(ownText(el)));
    const first = await waitFor(() => detailsModal() || findHead(), 25000);
    if (first && detailsModal()) { const det = await readDetailsModal(detailsModal()); return soDone({ ok: false, detail: det, msg: det }); }
    const head = first || findHead();
    if (!head) return soDone({ ok: false, search: job.via === "direct", retry: job.via !== "direct", msg: "the order page didn't load" });
    const shown = soKey(ownText(head).replace(/^order/i, ""));
    const urlId = new URLSearchParams(location.search).get("orderId") || "";
    const want = it.order && !it.sci ? soKey(it.order) : "";
    const okOrder = (want && shown === want) || (!want && it.id && urlId === it.id) || (want && it.id && urlId === it.id);
    if (!okOrder) return soDone({ ok: false, search: job.via === "direct", msg: `page shows order ${shown}, the sheet says ${it.order || it.id}` });

    // wait until the items / Complete button are on the page
    const ready = await waitFor(() => completeBtn() || skuLeaves().length || bulkShipFlag(), 20000);
    if (bulkShipFlag()) return soDone({ ok: false, msg: "bulk ship" });     // this order belongs to a Bulk Ship batch
    if (!ready) return soDone({ ok: false, search: job.via === "direct", retry: job.via !== "direct", msg: "nothing to pack on the order page" });
    await sleep(500);
    if (job.match) {          // the order must belong to the chosen client (badge next to the order number / shipping method)
      let area = ""; let p = head;
      for (let i = 0; i < 3 && p.parentElement; i++) { p = p.parentElement; if ((p.innerText || "").length > 400) break; area = p.innerText || area; }
      const sm = [...document.querySelectorAll("div, span, p, label")].find((el) => visible(el) && /^shipping method$/i.test(ownText(el)));
      if (sm && sm.parentElement) area += " " + sm.parentElement.innerText;
      const tags = [...document.querySelectorAll("span, div")].filter((el) => visible(el) && el.childElementCount === 0 && /^[A-Z0-9_ .\-]{3,30}$/.test((el.textContent || "").trim()) && el.getBoundingClientRect().top < 220).map((el) => el.textContent).join(" ");
      area += " " + tags + " " + (head.parentElement ? head.parentElement.textContent : "");
      if (!norm(area).includes(norm(job.match))) {      // narrow / minimised window: the badge can be collapsed - look at the whole order page
        const page = [...document.body.children].filter((el) => !el.matches("#shipcube-so, #shipcube-bot, script, style")).map((el) => el.textContent || "").join(" ");
        if (!norm(page).includes(norm(job.match))) return soDone({ ok: false, msg: `not a ${job.client} order` });
      }
    }
    const pk = packages();
    if (pk.length > 1) return soDone({ ok: false, msg: `${pk.length} packages on this order — please do it by hand` });

    // click every item on the left until everything is in the package
    soStage("pack", `row ${it.row} · packing items…`);
    let clicks = 0, stuck = 0;
    for (;;) {
      const s = soSides();
      if (!s.left.length) break;
      if (clicks >= 300) return soDone({ ok: false, msg: "too many clicks packing the items — please check" });
      const sig = s.left.length + "|" + s.rightUnits + "|" + s.right.length;
      const target = s.left[0].parentElement || s.left[0];
      target.scrollIntoView({ block: "center" });
      realClick(target); clicks++;
      const moved = await waitFor(() => { const n = soSides(); return (n.left.length + "|" + n.rightUnits + "|" + n.right.length) !== sig; }, 3000, 150);
      if (!moved) { if (++stuck >= 3) return soDone({ ok: false, msg: "clicking the item on the left didn't move it into the package" }); }
      else stuck = 0;
    }
    await sleep(400);

    if (detailsModal()) { const det = await readDetailsModal(detailsModal()); return soDone({ ok: false, detail: det, msg: det }); }
    // total units in the package
    const s = soSides();
    const badge = packageBadge(packages()[0]);
    const units = badge || s.rightUnits;
    if (!units) return soDone({ ok: false, msg: "couldn't read how many units are in the package" });
    if (badge && s.rightUnits && !s.rightUnknown && badge !== s.rightUnits) soChip(`package says ${badge}, items add up to ${s.rightUnits} — using ${badge}`);

    // box by quantity
    const box = soBoxFor(units, job.rules);
    if (!box) return soDone({ ok: false, msg: `no box rule for ${units} unit(s) (⚙ Settings → Single orders)` });
    soStage("box", `row ${it.row} · ${units} unit(s) → ${box}`);
    const bc0 = await waitFor(() => boxControl(), 10000);
    if (!bc0) return soDone({ ok: false, retry: true, msg: "couldn't find the Shipping box dropdown" });
    const pick = await chooseBox(box);                     // (2) patient: ShipHero can load the box list late
    if (!pick.ok) return soDone({ ok: false, retry: !pick.notInList, msg: pick.notInList ? `“${box}” is not in ShipHero's box list` : `couldn't set the box to “${box}” (page slow)` });

    if (job.dry) return soDone({ ok: true, dry: true, qty: units, box });

    // Complete order (the main part of the button, never the arrow menu)
    const btn = await waitFor(() => { const b = completeBtn(); return b && !b.disabled && b.getAttribute("aria-disabled") !== "true" ? b : null; }, 8000);
    if (!btn) return soDone(completeBtn() ? { ok: false, msg: "Complete order is disabled" }
      : { ok: false, search: job.via === "direct", msg: "no Complete order button (already shipped?)" });
    soStage("complete", `row ${it.row} · completing…`);
    const before = location.href;
    const ERR = /error|fail|unable|could not|couldn't|invalid|required|select a station/i, OKT = /complet|shipped|success/i;
    const errBefore = popupText(ERR), okBefore = popupText(OKT), dlgBefore = openDialog();
    const leaf = [...btn.querySelectorAll("span, div")].find((x) => x.childElementCount === 0 && /complete order/i.test(x.textContent || "")) || btn;
    leaf.click();
    const out = await waitFor(() => {
      const err = popupText(ERR);
      if (err && err !== errBefore) return "err:" + err;
      if (location.href !== before) return "nav";
      if (detailsModal()) return "det:";
      const dlg = openDialog(); if (dlg && dlg !== dlgBefore) return "dlg:" + dlg;
      if (!completeBtn()) return "gone";
      const okt = popupText(OKT); if (okt && okt !== okBefore) return "toast";
      return null;
    }, 45000, 300);
    if (!out) return soDone({ ok: false, msg: "no confirmation after Complete order (45 s) — check this order" });
    if (/bulk[\s_-]*ship/i.test(out)) return soDone({ ok: false, msg: "bulk ship" });
    if (out.startsWith("err:")) return soDone({ ok: false, msg: "ShipHero: " + out.slice(4) });
    if (out === "det:") { const det = await readDetailsModal(detailsModal()); return soDone({ ok: false, detail: det, msg: det }); }
    if (out.startsWith("dlg:")) return soDone({ ok: false, msg: "ShipHero asked: " + out.slice(4) });
    return soDone({ ok: true, qty: units, box, value: job.value });
  }

  // ---------------- auto-run on batch pages ----------------
  let lastRunUrl = null, waitTimer = null;
  function tick() {
    if (soMode) return;                      // a Single Orders tab: the worker above does everything
    if (isDashboard()) { handleDashboard(); return; }
    if (!bulkAllowed()) { if (panel) panel.style.display = "none"; return; }   // Bulk Ship automation is off on this PC
    const batchId = detectBatchPage();
    if (batchId) { buildPanel(); panel.style.display = ""; handleBatchPage(batchId); return; }
    if (PAGE_MATCH.test(location.pathname) && panel && !running) checkTopOrder(false);
    if (PAGE_MATCH.test(location.pathname) && (!statusInitial || statusInitial.key !== pageKey())) orderStatusState();
    if (!PAGE_MATCH.test(location.pathname)) { if (panel) panel.style.display = "none"; return; }
    scheduleEmptyCheck();
    buildPanel();
    panel.style.display = "";
    if (!autoBox.checked || lastRunUrl === pageKey()) return;
    if (findSection()) {
      lastRunUrl = pageKey();
      clearTimeout(waitTimer);
      waitTimer = setTimeout(() => { log("Batch page detected - running…"); run(); }, 1500);
    }
  }
  new MutationObserver(() => { clearTimeout(tick._t); tick._t = setTimeout(tick, 400); })
    .observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("message", async (e) => {
    if (e.source !== window || !e.data || e.data.__shipcube !== "cmd") return;
    const c = e.data.cmd;
    if (c === "settings") {
      buildPanel(); panel.classList.add("scb-show", "min");
      if (!panel.querySelector(".scb-settings")) openSettings();
      const w = setInterval(() => { if (!panel.querySelector(".scb-settings")) { panel.classList.remove("scb-show"); clearInterval(w); } }, 800);
      return;
    }
    if (!PAGE_MATCH.test(location.pathname) && c !== "debug") { log("Open a Bulk Ship batch page first.", "warn"); return; }
    buildPanel();
    if (c === "fill") run(true);
    else if (c === "pick") { pickDoneUrl = null; pickLocations(true); }
    else if (c === "rows") setRowsPerPage(true);
    else if (c === "select") { await selectAllOrders(true); const n = selectedCount(findHeaderCheckbox()); if (n) await recordSelection(n); }
    else if (c === "debug") copyDebug();
    else if (c === "copyid") { lastCopied = null; checkTopOrder(true); }
  });
  soBoot();
  refreshQueueMine().then(async (mine) => { tick(); if (!mine) { await sleep(2500); if (await refreshQueueMine()) tick(); } });   // a queue tab can be registered a moment after it opens
})();
