import { useState, useCallback } from 'react';

/**
 * Custom hook for managing modal state and operations
 *
 * @param {Object} options - Configuration options
 * @param {*} options.initialData - Initial data state for the modal
 * @returns {Object} Modal state and control functions
 *
 * @example
 * const deleteModal = useModal();
 * const editModal = useModal({ initialData: null });
 *
 * // In component:
 * deleteModal.open();
 * editModal.openWithData(someData);
 * deleteModal.close();
 */
export function useModal(options = {}) {
  const { initialData = null } = options;

  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const open = useCallback(() => {
    setIsOpen(true);
    setError('');
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setData(initialData);
    setIsLoading(false);
    setError('');
  }, [initialData]);

  const openWithData = useCallback((newData) => {
    setData(newData);
    setIsOpen(true);
    setError('');
  }, []);

  const setModalData = useCallback((newData) => {
    setData(newData);
  }, []);

  const setModalLoading = useCallback((loading) => {
    setIsLoading(loading);
  }, []);

  const setModalError = useCallback((err) => {
    setError(err);
  }, []);

  const reset = useCallback(() => {
    setData(initialData);
    setIsLoading(false);
    setError('');
  }, [initialData]);

  return {
    isOpen,
    data,
    isLoading,
    error,
    open,
    close,
    openWithData,
    setData: setModalData,
    setLoading: setModalLoading,
    setError: setModalError,
    reset,
  };
}
