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
        const addLevel2 = (section) => {
          if (!Array.isArray(section)) return;
          section.forEach((entry) => {
            if (!entry || typeof entry !== "object") return;
            const [key] = Object.keys(entry);
            if (key) {
              if (!seen.has(key)) {
                seen.add(key);
                options.push(key);
              }
              const names = [];
              const addLeaves = (node) => {
                if (typeof node === "string") {
                  names.push(node);
                  if (!leafToAccount[node]) leafToAccount[node] = key;
                  return;
                }
                if (Array.isArray(node)) {
                  node.forEach((item) => addLeaves(item));
                  return;
                }
                if (node && typeof node === "object") {
                  Object.entries(node).forEach(([k, v]) => {
                    addLeaves(k);
                    addLeaves(v);
                  });
                }
              };
              addLeaves(entry[key]);
              namesByAccount[key] = names;
            }
          });
        };

        (Array.isArray(data) ? data : []).forEach((group) => {
          if (!group || typeof group !== "object") return;
          Object.values(group).forEach(addLevel2);
        });

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
