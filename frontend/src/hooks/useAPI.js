import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Custom hook for managing API calls with loading, error states, and proper cleanup
 *
 * @param {Function} apiFn - Async function that makes the API call
 * @param {Object} options - Configuration options
 * @param {boolean} options.immediate - Whether to call API immediately on mount (default: false)
 * @param {Array} options.deps - Dependencies array for auto-refetch (default: [])
 * @param {Function} options.onSuccess - Callback on successful API call
 * @param {Function} options.onError - Callback on API error
 * @returns {Object} API state and control functions
 *
 * @example
 * // Auto-fetch on mount
 * const { data, isLoading, error, refetch } = useAPI(
 *   () => Rest.fetchJson('/api/balance'),
 *   { immediate: true }
 * );
 *
 * // Manual fetch
 * const { data, isLoading, error, execute } = useAPI(
 *   (params) => Rest.fetchJson(`/api/data?id=${params.id}`)
 * );
 * // Later: execute({ id: 123 });
 */
export function useAPI(apiFn, options = {}) {
  const {
    immediate = false,
    deps = [],
    onSuccess,
    onError,
  } = options;

  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const execute = useCallback(async (...args) => {
    if (!isMountedRef.current) return;

    setIsLoading(true);
    setError('');

    try {
      const result = await apiFn(...args);

      if (!isMountedRef.current) return;

      setData(result);
      setError('');

      if (onSuccess) {
        onSuccess(result);
      }

      return result;
    } catch (err) {
      if (!isMountedRef.current) return;

      const errorMessage = err.message || 'An error occurred';
      setError(errorMessage);
      setData(null);

      if (onError) {
        onError(err);
      }

      throw err;
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [apiFn, onSuccess, onError]);

  // Auto-fetch on mount or when deps change
  useEffect(() => {
    if (immediate) {
      execute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [immediate, ...deps]);

  const reset = useCallback(() => {
    if (!isMountedRef.current) return;
    setData(null);
    setError('');
    setIsLoading(false);
  }, []);

  return {
    data,
    isLoading,
    error,
    execute,
    refetch: execute,
    reset,
  };
}

/**
 * Hook for managing multiple related API states (useful for pages with multiple endpoints)
 *
 * @returns {Object} Methods to register and manage multiple API states
 *
 * @example
 * const api = useMultiAPI();
 *
 * const loadData = async () => {
 *   api.setLoading('assumptions', true);
 *   try {
 *     const data = await Rest.fetchJson('/api/assumptions');
 *     api.setData('assumptions', data);
 *   } catch (err) {
 *     api.setError('assumptions', err.message);
 *   }
 * };
 *
 * // Access: api.state.assumptions.data, api.state.assumptions.isLoading, etc.
 */
export function useMultiAPI() {
  const [state, setState] = useState({});

  const setLoading = useCallback((key, isLoading) => {
    setState(prev => ({
      ...prev,
      [key]: { ...prev[key], isLoading, error: '' }
    }));
  }, []);

  const setData = useCallback((key, data) => {
    setState(prev => ({
      ...prev,
      [key]: { ...prev[key], data, isLoading: false, error: '' }
    }));
  }, []);

  const setError = useCallback((key, error) => {
    setState(prev => ({
      ...prev,
      [key]: { ...prev[key], error, isLoading: false, data: null }
    }));
  }, []);

  const reset = useCallback((key) => {
    if (key) {
      setState(prev => ({
        ...prev,
        [key]: { data: null, isLoading: false, error: '' }
      }));
    } else {
      setState({});
    }
  }, []);

  return {
    state,
    setLoading,
    setData,
    setError,
    reset,
  };
}
