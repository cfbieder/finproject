import { useEffect, useState } from "react";
import Rest from "../../../js/rest.js";
import {
  DEFAULT_ACCOUNT_OPTIONS,
  DEFAULT_CATEGORY_OPTIONS,
  CATEGORY_GROUP_EXPENSE,
  ensureAllOption,
} from "../utils/budgetInputUtils.js";

/**
 * Custom hook for managing account and category filter options.
 * Loads available accounts and categories from the API and manages selection state.
 *
 * @returns {Object} Filter options state
 * @property {Array} accountOptions - Available account options
 * @property {Array} categoryOptions - Available category options
 * @property {Array} selectedAccounts - Currently selected accounts
 * @property {Array} selectedCategories - Currently selected categories
 * @property {Object} categoryGroups - Income and Expense category groups
 * @property {Function} setSelectedAccounts - Update selected accounts
 * @property {Function} setSelectedCategories - Update selected categories
 * @property {boolean} loading - Whether options are being loaded
 * @property {string} error - Error message if loading failed
 */
export function useFilterOptions() {
  const [accountOptions, setAccountOptions] = useState(DEFAULT_ACCOUNT_OPTIONS);
  const [categoryOptions, setCategoryOptions] = useState(
    DEFAULT_CATEGORY_OPTIONS
  );
  const [selectedAccounts, setSelectedAccounts] = useState(["All"]);
  const [selectedCategories, setSelectedCategories] = useState([
    CATEGORY_GROUP_EXPENSE,
  ]);
  const [categoryGroups, setCategoryGroups] = useState({
    Income: [],
    Expense: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /**
   * Loads filter options (accounts, categories, category groups) from the API.
   */
  useEffect(() => {
    let isMounted = true;

    const loadFilters = async () => {
      setLoading(true);
      setError("");
      try {
        // Using v2 API (PostgreSQL) for accounts, categories, and category groups
        const [accountsData, categoriesData, categoryGroupPayload] = await Promise.all([
          Rest.fetchAccountsV2({ activeOnly: true, section: 'balance_sheet', leafOnly: true }),
          Rest.fetchCategoriesV2({ activeOnly: true }),
          Rest.fetchCategoryGroupsV2(),
        ]);
        if (!isMounted) return;

        // Extract names from v2 response objects (leafOnly excludes parent/grouping nodes)
        const accounts = Array.isArray(accountsData)
          ? accountsData.map((acc) => acc?.name).filter(Boolean)
          : [];
        const categories = Array.isArray(categoriesData)
          ? categoriesData.map((cat) => cat?.name).filter(Boolean)
          : [];

        if (accounts.length) {
          setAccountOptions(ensureAllOption(accounts));
        }

        if (categories.length) {
          setCategoryOptions(categories);
        }

        setCategoryGroups({
          Income: Array.isArray(categoryGroupPayload?.Income)
            ? categoryGroupPayload.Income
            : [],
          Expense: Array.isArray(categoryGroupPayload?.Expense)
            ? categoryGroupPayload.Expense
            : [],
        });
      } catch (err) {
        if (isMounted) {
          console.error("[useFilterOptions] Failed to load filter options:", err);
          setError(err.message || "Failed to load filter options");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadFilters();
    return () => {
      isMounted = false;
    };
  }, []);

  return {
    accountOptions,
    categoryOptions,
    selectedAccounts,
    selectedCategories,
    categoryGroups,
    setSelectedAccounts,
    setSelectedCategories,
    loading,
    error,
  };
}
