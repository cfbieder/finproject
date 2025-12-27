import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import Rest from '@lib/rest';

/**
 * Forecast Context
 *
 * Provides shared state for forecast-related data across all forecast pages.
 * Prevents duplicate API calls for assumptions and scenarios data.
 */

const ForecastContext = createContext(null);

/**
 * Hook to access forecast context.
 * Must be used within a ForecastProvider.
 *
 * @returns {Object} Forecast context value
 * @throws {Error} If used outside ForecastProvider
 *
 * @example
 * function MyComponent() {
 *   const { assumptions, scenarios, isLoading } = useForecast();
 *   return <div>{scenarios.map(s => s.Name)}</div>;
 * }
 */
export function useForecast() {
  const context = useContext(ForecastContext);
  if (!context) {
    throw new Error('useForecast must be used within a ForecastProvider');
  }
  return context;
}

/**
 * Forecast Provider Component
 *
 * Wraps forecast-related pages to provide shared state.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - Child components
 *
 * @example
 * <ForecastProvider>
 *   <FCScenarios />
 *   <FCModuleManage />
 *   <FCExpSetup />
 * </ForecastProvider>
 */
export function ForecastProvider({ children }) {
  // Assumptions state
  const [assumptions, setAssumptions] = useState(null);
  const [isLoadingAssumptions, setIsLoadingAssumptions] = useState(false);
  const [assumptionsError, setAssumptionsError] = useState('');

  // Derived scenarios from assumptions
  const scenarios = assumptions?.scenarios || [];
  const periodStart = assumptions?.period_start;
  const periodEnd = assumptions?.period_end;

  /**
   * Loads forecast assumptions from API.
   * Can be called to refresh the data.
   */
  const loadAssumptions = useCallback(async () => {
    setIsLoadingAssumptions(true);
    setAssumptionsError('');

    try {
      const data = await Rest.fetchJson('/api/forecast/assumptions');
      setAssumptions(data);
      setAssumptionsError('');
    } catch (err) {
      console.error('Failed to load forecast assumptions:', err);
      setAssumptionsError(err.message || 'Failed to load assumptions');
      setAssumptions(null);
    } finally {
      setIsLoadingAssumptions(false);
    }
  }, []);

  /**
   * Refreshes assumptions data from server.
   * Useful after creating/updating scenarios.
   */
  const refreshAssumptions = useCallback(() => {
    return loadAssumptions();
  }, [loadAssumptions]);

  /**
   * Gets a scenario by name.
   *
   * @param {string} name - Scenario name
   * @returns {Object|null} Scenario object or null if not found
   */
  const getScenarioByName = useCallback((name) => {
    if (!name || !scenarios.length) {
      return null;
    }
    return scenarios.find(s => s.Name === name) || null;
  }, [scenarios]);

  /**
   * Checks if a scenario exists.
   *
   * @param {string} name - Scenario name
   * @returns {boolean} True if scenario exists
   */
  const hasScenario = useCallback((name) => {
    return scenarios.some(s => s.Name === name);
  }, [scenarios]);

  // Load assumptions on mount
  useEffect(() => {
    loadAssumptions();
  }, [loadAssumptions]);

  const value = {
    // Assumptions data
    assumptions,
    scenarios,
    periodStart,
    periodEnd,

    // Loading states
    isLoadingAssumptions,
    assumptionsError,

    // Methods
    loadAssumptions,
    refreshAssumptions,
    getScenarioByName,
    hasScenario,
  };

  return (
    <ForecastContext.Provider value={value}>
      {children}
    </ForecastContext.Provider>
  );
}

ForecastProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export default ForecastContext;
