import { useEffect, useState } from "react";
import Rest from "../../../js/rest.js";

/**
 * Hook for loading COA hierarchy and building account lookup tables.
 */
export function useFCExpAccountHierarchy() {
  const [accountOptions, setAccountOptions] = useState([]);
  const [accountNameOptions, setAccountNameOptions] = useState({});
  const [leafAccountLookup, setLeafAccountLookup] = useState({});

  useEffect(() => {
    let isMounted = true;

    const loadAccounts = async () => {
      try {
        const data = await Rest.fetchJson("/api/v2/util/coa/CashFlow");
        if (!isMounted) return;

        const options = [];
        const seen = new Set();
        const namesByAccount = {};
        const leafToAccount = {};

        // getNestedTree returns { name, children } nodes
        const collectLeafNames = (children, parentKey) => {
          if (!Array.isArray(children)) return [];
          const names = [];
          for (const child of children) {
            if (!child || typeof child !== "object") continue;
            if (child.children && child.children.length > 0) {
              names.push(...collectLeafNames(child.children, parentKey));
            } else if (child.name) {
              names.push(child.name);
              if (!leafToAccount[child.name]) leafToAccount[child.name] = parentKey;
            }
          }
          return names;
        };

        // Level 1 nodes are the top-level groups (Income, Expense)
        // Level 2 nodes are the account categories we want in the dropdown
        const tree = Array.isArray(data) ? data : [];
        for (const level1 of tree) {
          if (!level1 || typeof level1 !== "object") continue;
          const level2Children = level1.children || [];
          for (const level2 of level2Children) {
            if (!level2 || !level2.name) continue;
            const key = level2.name;
            if (!seen.has(key)) {
              seen.add(key);
              options.push(key);
            }
            namesByAccount[key] = collectLeafNames(level2.children || [], key);
          }
        }

        setAccountOptions(options);
        setAccountNameOptions(namesByAccount);
        setLeafAccountLookup(leafToAccount);
      } catch {
        if (isMounted) {
          setAccountOptions([]);
          setAccountNameOptions({});
          setLeafAccountLookup({});
        }
      }
    };

    loadAccounts();
    return () => { isMounted = false; };
  }, []);

  return { accountOptions, accountNameOptions, leafAccountLookup };
}
