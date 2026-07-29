import React from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { ErrorBoundary } from '@ohif/ui-next';
import { DicomMetadataStore } from '@ohif/core';

// Route Components
// Study list variants are selected by the `workList.variant` customization:
// - `'legacy'`  → LegacyWorkList (the pre-3.13 study list)
// - anything else (including `'default'`) → WorkList (ui-next study list)
import WorkList from './WorkList/WorkList';
import LegacyWorkList from './LegacyWorkList/LegacyWorkList';
import DataSourceWrapper from './DataSourceWrapper';
import Local from './Local';
import HealthrayNotice from '../components/HealthrayNotice';
import buildModeRoutes from './buildModeRoutes';
import PrivateRoute from './PrivateRoute';
import { routerBasename } from '../utils/publicUrl';
import { useAppConfig } from '@state';
import { history } from '../utils/history';

// This deployment has exactly one entry point: `/home?url=<zip or dcm>`.
// Everything else is either an allowed continuation of that flow (see
// ALLOWED_MODE_ROUTES) or renders the Healthray notice.
//
// `/notfoundserver`, `/notfoundstudy`, `/debug` and `/localbasic` are
// deliberately no longer registered. Code that still navigates to them
// (Mode.tsx -> '/notfoundstudy', DataSourceWrapper -> '/notfoundserver') now
// falls through to the notFoundRoute below, which is the desired outcome.
const bakedInRoutes = [
  {
    path: `/home`,
    children: Local.bind(null, { modePath: '' }), // navigate to the worklist
  },
];

// Mode routes that stay reachable. `viewer` renders the loaded study; `microscopy`
// is required because Local.tsx redirects SM (slide microscopy) studies to it.
// Paths from buildModeRoutes carry no leading slash, e.g. `viewer/dicomlocal`.
const ALLOWED_MODE_ROUTES = ['viewer', 'microscopy'];

const isAllowedModeRoute = (path: string) =>
  ALLOWED_MODE_ROUTES.some(name => path === name || path.startsWith(`${name}/`));

/**
 * Gates a route on there being at least one study in the in-memory
 * DicomMetadataStore, which only `/home` populates.
 *
 * This does double duty:
 *  - locks the viewer down so it cannot be used as an entry point, and
 *  - replaces the blank page you would otherwise get by refreshing or
 *    deep-linking a viewer URL. `dicomlocal.getStudyInstanceUIDs` returns []
 *    against a cold store, which makes Mode.tsx skip its /notfoundstudy
 *    redirect and fall through to `return null`.
 */
const withLoadedStudies = (Component: React.ComponentType<any>) =>
  function GatedRoute(props: Record<string, unknown>) {
    if (!DicomMetadataStore.getStudyInstanceUIDs().length) {
      return <HealthrayNotice />;
    }
    return <Component {...props} />;
  };

// Anything unmatched — including every disallowed mode and the removed
// baked-in routes — shows the notice.
const notFoundRoute = { path: '*', children: HealthrayNotice };

const createRoutes = ({
  modes,
  dataSources,
  extensionManager,
  servicesManager,
  commandsManager,
  hotkeysManager,
  showStudyList,
}: withAppTypes) => {
  const routes = (
    buildModeRoutes({
      modes,
      dataSources,
      extensionManager,
      servicesManager,
      commandsManager,
      hotkeysManager,
    }) || []
  )
    // Drop every mode this deployment does not allow, and gate the survivors on
    // a study actually having been loaded via /home.
    .filter(route => isAllowedModeRoute(route.path))
    .map(route => ({ ...route, children: withLoadedStudies(route.children) }));

  const { customizationService } = servicesManager.services;

  const path =
    routerBasename.length > 1 && routerBasename.endsWith('/')
      ? routerBasename.substring(0, routerBasename.length - 1)
      : routerBasename;

  console.log('Registering worklist route', routerBasename, path);

  const workListVariant = customizationService.getCustomization('workList.variant');
  const WorkListComponent = workListVariant === 'legacy' ? LegacyWorkList : WorkList;

  // `/` stays registered because /home navigates to it, but it only renders the
  // study list once /home has actually loaded studies; otherwise the notice.
  const WorkListRoute = {
    path: '/',
    children: withLoadedStudies(DataSourceWrapper),
    private: true,
    props: { children: WorkListComponent, servicesManager, extensionManager, commandsManager },
  };

  const customRoutes = customizationService.getCustomization('routes.customRoutes');

  const allRoutes = [
    ...routes,
    ...(showStudyList ? [WorkListRoute] : []),
    ...(customRoutes?.routes || []),
    ...bakedInRoutes,
    customRoutes?.notFoundRoute || notFoundRoute,
  ];

  function RouteWithErrorBoundary({ route, ...rest }) {
    const [appConfig] = useAppConfig();
    const { showErrorDetails } = appConfig;

    history.navigate = useNavigate();

    // eslint-disable-next-line react/jsx-props-no-spreading
    return (
      <ErrorBoundary
        context={`Route ${route.path}`}
        showErrorDetails={showErrorDetails}
      >
        <route.children
          {...rest}
          {...route.props}
          route={route}
          servicesManager={servicesManager}
          extensionManager={extensionManager}
          hotkeysManager={hotkeysManager}
        />
      </ErrorBoundary>
    );
  }

  const { userAuthenticationService } = servicesManager.services;

  // All routes are private by default and then we let the user auth service
  // to check if it is enabled or not
  // Todo: I think we can remove the second public return below
  return (
    <Routes>
      {allRoutes.map((route, i) => {
        return route.private === true ? (
          <Route
            key={i}
            path={route.path}
            element={
              <PrivateRoute
                handleUnauthenticated={() => userAuthenticationService.handleUnauthenticated()}
              >
                <RouteWithErrorBoundary route={route} />
              </PrivateRoute>
            }
          ></Route>
        ) : (
          <Route
            key={i}
            path={route.path}
            element={<RouteWithErrorBoundary route={route} />}
          />
        );
      })}
    </Routes>
  );
};

export default createRoutes;
