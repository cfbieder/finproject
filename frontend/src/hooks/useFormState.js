import { useState, useCallback } from 'react';

/**
 * Custom hook for managing form state with validation
 *
 * @param {Object} initialValues - Initial form field values
 * @param {Object} options - Configuration options
 * @param {Function} options.validate - Validation function that returns errors object
 * @param {Function} options.onSubmit - Form submission handler
 * @returns {Object} Form state and control functions
 *
 * @example
 * const form = useFormState(
 *   { name: '', email: '' },
 *   {
 *     validate: (values) => {
 *       const errors = {};
 *       if (!values.name) errors.name = 'Name is required';
 *       if (!values.email) errors.email = 'Email is required';
 *       return errors;
 *     },
 *     onSubmit: async (values) => {
 *       await Rest.postJson('/api/users', values);
 *     }
 *   }
 * );
 *
 * // In JSX:
 * <input value={form.values.name} onChange={form.handleChange('name')} />
 * {form.errors.name && <span>{form.errors.name}</span>}
 * <button onClick={form.handleSubmit} disabled={form.isSubmitting}>Submit</button>
 */
export function useFormState(initialValues = {}, options = {}) {
  const { validate, onSubmit } = options;

  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const handleChange = useCallback((fieldName) => (event) => {
    const value = event.target ? event.target.value : event;
    setValues(prev => ({
      ...prev,
      [fieldName]: value
    }));
    // Clear field error when user starts typing
    if (errors[fieldName]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[fieldName];
        return newErrors;
      });
    }
  }, [errors]);

  const handleBlur = useCallback((fieldName) => () => {
    setTouched(prev => ({
      ...prev,
      [fieldName]: true
    }));

    // Validate single field on blur if validator provided
    if (validate) {
      const validationErrors = validate(values);
      if (validationErrors[fieldName]) {
        setErrors(prev => ({
          ...prev,
          [fieldName]: validationErrors[fieldName]
        }));
      }
    }
  }, [validate, values]);

  const setFieldValue = useCallback((fieldName, value) => {
    setValues(prev => ({
      ...prev,
      [fieldName]: value
    }));
  }, []);

  const setFieldError = useCallback((fieldName, error) => {
    setErrors(prev => ({
      ...prev,
      [fieldName]: error
    }));
  }, []);

  const handleSubmit = useCallback(async (event) => {
    if (event && event.preventDefault) {
      event.preventDefault();
    }

    setSubmitError('');

    // Validate all fields
    if (validate) {
      const validationErrors = validate(values);
      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors);
        return;
      }
    }

    if (!onSubmit) {
      return values;
    }

    setIsSubmitting(true);

    try {
      const result = await onSubmit(values);
      return result;
    } catch (err) {
      const errorMessage = err.message || 'Form submission failed';
      setSubmitError(errorMessage);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }, [values, validate, onSubmit]);

  const reset = useCallback((newValues = initialValues) => {
    setValues(newValues);
    setErrors({});
    setTouched({});
    setIsSubmitting(false);
    setSubmitError('');
  }, [initialValues]);

  const setFormValues = useCallback((newValues) => {
    setValues(newValues);
  }, []);

  return {
    values,
    errors,
    touched,
    isSubmitting,
    submitError,
    handleChange,
    handleBlur,
    handleSubmit,
    setFieldValue,
    setFieldError,
    setValues: setFormValues,
    reset,
  };
}

/**
 * Simplified hook for basic form state without validation
 *
 * @param {Object} initialValues - Initial form field values
 * @returns {Object} Form values and setter function
 *
 * @example
 * const [form, setForm] = useSimpleForm({ name: '', email: '' });
 *
 * // Update single field
 * setForm('name', 'John');
 *
 * // Update multiple fields
 * setForm({ name: 'John', email: 'john@example.com' });
 */
export function useSimpleForm(initialValues = {}) {
  const [values, setValues] = useState(initialValues);

  const updateForm = useCallback((fieldNameOrValues, value) => {
    if (typeof fieldNameOrValues === 'string') {
      // Update single field
      setValues(prev => ({
        ...prev,
        [fieldNameOrValues]: value
      }));
    } else {
      // Update multiple fields
      setValues(prev => ({
        ...prev,
        ...fieldNameOrValues
      }));
    }
  }, []);

  const reset = useCallback(() => {
    setValues(initialValues);
  }, [initialValues]);

  return [values, updateForm, reset];
}
