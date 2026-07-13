import { useMemo } from "react";
import { Link, useLocation, Navigate } from "react-router-dom";
import {
  getCategoryByPath,
  getRoutesByCategory,
  CATEGORY_META,
} from "../config/routes";
import { ArrowRight } from "lucide-react";
import "./CategoryLandingPage.css";

export default function CategoryLandingPage() {
  const { pathname } = useLocation();
  const categoryName = getCategoryByPath(pathname);

  const categoryRoutes = useMemo(
    () => (categoryName ? getRoutesByCategory(categoryName) : []),
    [categoryName]
  );

  const meta = categoryName ? CATEGORY_META[categoryName] : null;
  const CategoryIcon = meta?.icon;

  // Group by subcategory.
  //
  // This must run BEFORE the no-category redirect below: it used to sit after the early
  // return, so on a bad path the component rendered one hook fewer than on a good one —
  // a real rules-of-hooks violation. Nothing here needs a category: categoryRoutes is []
  // when there is none, and the loop is a no-op.
  const { ungrouped, subcategories } = useMemo(() => {
    const ungrouped = [];
    const subMap = new Map();

    for (const route of categoryRoutes) {
      if (route.subcategory) {
        if (!subMap.has(route.subcategory)) {
          subMap.set(route.subcategory, []);
        }
        subMap.get(route.subcategory).push(route);
      } else {
        ungrouped.push(route);
      }
    }

    return {
      ungrouped,
      subcategories: Array.from(subMap.entries()),
    };
  }, [categoryRoutes]);

  // Redirect to home if the path is not a known category. Below every hook, so the hook
  // order is identical on every render.
  if (!categoryName) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="category-landing">
      <header className="category-landing__header">
        {CategoryIcon && (
          <div className="category-landing__icon-wrap">
            <CategoryIcon size={36} strokeWidth={1.5} />
          </div>
        )}
        <h1 className="category-landing__title">{categoryName}</h1>
        {meta?.description && (
          <p className="category-landing__description">{meta.description}</p>
        )}
      </header>

      {ungrouped.length > 0 && (
        <div className="category-landing__grid">
          {ungrouped.map((route) => (
            <FeatureCard key={route.path} route={route} />
          ))}
        </div>
      )}

      {subcategories.map(([subName, subRoutes]) => (
        <section key={subName} className="category-landing__section">
          <h2 className="category-landing__section-title">{subName}</h2>
          <div className="category-landing__grid">
            {subRoutes.map((route) => (
              <FeatureCard key={route.path} route={route} />
            ))}
          </div>
        </section>
      ))}

    </div>
  );
}

function FeatureCard({ route }) {
  const Icon = route.icon;

  return (
    <Link to={route.path} className="feature-card">
      <div className="feature-card__icon-area">
        {Icon && <Icon size={28} strokeWidth={1.5} />}
      </div>
      <div className="feature-card__content">
        <h3 className="feature-card__title">{route.label}</h3>
        {route.description && (
          <p className="feature-card__description">{route.description}</p>
        )}
      </div>
      <div className="feature-card__arrow">
        <ArrowRight size={18} strokeWidth={2} />
      </div>
    </Link>
  );
}
