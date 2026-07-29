/**
 * amountFormula.js — evaluate a money amount typed as an arithmetic expression.
 *
 * The Ledger's Add-Transaction amount is often a figure you have to work out
 * first ("11,000 - 9,600"), and doing that in another window loses the working.
 * This lets the field take the expression itself.
 *
 * Implemented as a hand-written recursive-descent parser. NOT `eval` and NOT
 * `new Function` — the input is a money value, and there is no reason for a
 * money field to be able to execute anything.
 *
 * Supports: + - * / , parentheses, unary +/-, decimals, and thousands-grouped
 * integers (11,000). A bare number still parses, so every amount that worked
 * before works unchanged.
 *
 * THE COMMA RULE IS THE LOAD-BEARING PART. A comma is accepted ONLY in a valid
 * thousands position — `\d{1,3}(,\d{3})+`. "1,5" is rejected rather than read
 * as 15, because someone typing a European decimal comma would otherwise get a
 * silently 10x-wrong money value that nothing downstream could catch. Rejecting
 * is recoverable; a wrong number written to the ledger is not.
 *
 * Results are rounded to 2 decimals so the previewed figure is exactly what
 * gets stored — "11,000/3" reads 3,666.67, not 3666.6666666666665.
 */

const TOKEN_NUMBER = "num";
const TOKEN_OP = "op";
const TOKEN_LPAREN = "(";
const TOKEN_RPAREN = ")";

/** True when the text is more than a plain signed number, i.e. worth previewing. */
export function isFormula(raw) {
  if (typeof raw !== "string") return false;
  const s = raw.trim();
  if (s === "") return false;
  // A plain number (optionally signed, optionally comma-grouped) is not a formula.
  return !/^[+-]?(\d{1,3}(,\d{3})+|\d*)(\.\d*)?$/.test(s);
}

/**
 * Tokenize. Returns { tokens } or { error }.
 * Numbers are matched greedily so "11,000.50" is one token, and a comma that is
 * not part of a thousands group never reaches the parser.
 */
function tokenize(input) {
  const tokens = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (ch === " " || ch === "\t") {
      i += 1;
      continue;
    }

    if (ch === "(" || ch === ")") {
      tokens.push({ type: ch === "(" ? TOKEN_LPAREN : TOKEN_RPAREN });
      i += 1;
      continue;
    }

    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ type: TOKEN_OP, value: ch });
      i += 1;
      continue;
    }

    if (ch >= "0" && ch <= "9") {
      // Integer part: either comma-grouped (1,234,567) or a plain run of digits.
      const rest = input.slice(i);
      const grouped = /^\d{1,3}(,\d{3})+/.exec(rest);
      const plain = /^\d+/.exec(rest);
      const intPart = grouped ? grouped[0] : plain[0];
      // "1,2345" matches the grouped pattern up to "1,234" and would leave a
      // stray "5" behind as a second number — rejected either way, but say WHY.
      if (grouped && /^\d/.test(rest.slice(intPart.length))) {
        return {
          error:
            "Use a comma only as a thousands separator (1,250.00) and a period for decimals.",
        };
      }
      i += intPart.length;

      let decPart = "";
      if (input[i] === ".") {
        const dec = /^\.\d*/.exec(input.slice(i));
        decPart = dec[0];
        i += decPart.length;
      }

      // A comma still sitting here is not a thousands separator — bail rather
      // than silently truncating the number at the comma.
      if (input[i] === ",") {
        return {
          error:
            "Use a comma only as a thousands separator (1,250.00) and a period for decimals.",
        };
      }

      tokens.push({ type: TOKEN_NUMBER, value: Number(intPart.replace(/,/g, "") + decPart) });
      continue;
    }

    if (ch === ".") {
      const dec = /^\.\d+/.exec(input.slice(i));
      if (!dec) return { error: `Unexpected "." in the amount.` };
      tokens.push({ type: TOKEN_NUMBER, value: Number(dec[0]) });
      i += dec[0].length;
      continue;
    }

    if (ch === ",") {
      return {
        error:
          "Use a comma only as a thousands separator (1,250.00) and a period for decimals.",
      };
    }

    return { error: `"${ch}" is not something this amount field understands.` };
  }

  return { tokens };
}

/**
 * Evaluate a typed amount expression.
 * @param {string} raw
 * @returns {{ok: true, value: number} | {ok: false, error: string}}
 */
export function evaluateAmountFormula(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, error: "Please enter an amount." };
  }

  const { tokens, error } = tokenize(raw.trim());
  if (error) return { ok: false, error };
  if (tokens.length === 0) return { ok: false, error: "Please enter an amount." };

  let pos = 0;
  const peek = () => tokens[pos];
  let failure = null;
  const fail = (msg) => {
    if (!failure) failure = msg;
    return 0;
  };

  // expression := term (("+"|"-") term)*
  function parseExpression() {
    let left = parseTerm();
    while (!failure && peek()?.type === TOKEN_OP && (peek().value === "+" || peek().value === "-")) {
      const op = tokens[pos].value;
      pos += 1;
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  // term := factor (("*"|"/") factor)*
  function parseTerm() {
    let left = parseFactor();
    while (!failure && peek()?.type === TOKEN_OP && (peek().value === "*" || peek().value === "/")) {
      const op = tokens[pos].value;
      pos += 1;
      const right = parseFactor();
      if (op === "*") {
        left *= right;
      } else {
        // Division by zero yields Infinity, which would post as a garbage amount.
        if (right === 0) return fail("Cannot divide by zero.");
        left /= right;
      }
    }
    return left;
  }

  // factor := ("+"|"-") factor | "(" expression ")" | number
  function parseFactor() {
    const t = peek();
    if (!t) return fail("The amount ends with an incomplete calculation.");

    if (t.type === TOKEN_OP && (t.value === "+" || t.value === "-")) {
      pos += 1;
      const v = parseFactor();
      return t.value === "-" ? -v : v;
    }
    if (t.type === TOKEN_LPAREN) {
      pos += 1;
      const v = parseExpression();
      if (peek()?.type !== TOKEN_RPAREN) return fail("Missing a closing bracket.");
      pos += 1;
      return v;
    }
    if (t.type === TOKEN_NUMBER) {
      pos += 1;
      return t.value;
    }
    if (t.type === TOKEN_RPAREN) return fail("Unmatched closing bracket.");
    return fail("The amount is not a valid calculation.");
  }

  const value = parseExpression();
  if (failure) return { ok: false, error: failure };
  if (pos !== tokens.length) return { ok: false, error: "The amount is not a valid calculation." };
  if (!Number.isFinite(value)) return { ok: false, error: "That calculation has no finite result." };

  // Round to cents so the previewed figure is exactly what gets stored.
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return { ok: true, value: Object.is(rounded, -0) ? 0 : rounded };
}
