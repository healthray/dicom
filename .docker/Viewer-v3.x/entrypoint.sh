#!/bin/sh

# Origins the viewer is allowed to fetch imaging from, injected into the CSP
# connect-src directive. Narrow this to the origin that issues your signed URLs,
# e.g. CSP_CONNECT_SRC="https://media.example.com". The `https:` default permits
# any HTTPS origin so an unconfigured deployment still loads; it is a fallback,
# not a recommendation. Left unset with no default, envsubst would blank the
# directive and the viewer would fail to fetch anything.
: "${CSP_CONNECT_SRC:=https:}"
export CSP_CONNECT_SRC
echo "CSP connect-src allows: 'self' blob: data: ${CSP_CONNECT_SRC}"

if [ -n "$SSL_PORT" ]
  then
    envsubst '${SSL_PORT}:${PORT}:${CSP_CONNECT_SRC}' < /usr/src/default.ssl.conf.template | envsubst '${PUBLIC_URL}' > /etc/nginx/conf.d/default.conf
  else
    envsubst '${PORT}:${PUBLIC_URL}:${CSP_CONNECT_SRC}' < /usr/src/default.conf.template  > /etc/nginx/conf.d/default.conf
fi

if [ -n "$APP_CONFIG" ]; then
  echo "$APP_CONFIG" > /usr/share/nginx/html${PUBLIC_URL}app-config.js
  echo "Using custom APP_CONFIG environment variable"
else
  echo "Not using custom APP_CONFIG"
fi

if [ -f /usr/share/nginx/html${PUBLIC_URL}app-config.js ]; then
  if [ -s /usr/share/nginx/html${PUBLIC_URL}app-config.js ]; then
    echo "Detected non-empty app-config.js. Ensuring .gz file is updated..."
    rm -f /usr/share/nginx/html${PUBLIC_URL}app-config.js.gz
    gzip /usr/share/nginx/html${PUBLIC_URL}app-config.js
    touch /usr/share/nginx/html${PUBLIC_URL}app-config.js
    echo "Compressed app-config.js to app-config.js.gz"
  else
    echo "app-config.js is empty. Skipping compression."
  fi
else
  echo "No app-config.js file found. Skipping compression."
fi



if [ -n "$CLIENT_ID" ] || [ -n "$HEALTHCARE_API_ENDPOINT" ]
  then
    # If CLIENT_ID is specified, use the google.js configuration with the modified ID
    if [ -n "$CLIENT_ID" ]
      then
  	    echo "Google Cloud Healthcare \$CLIENT_ID has been provided: "
  	    echo "$CLIENT_ID"
  	    echo "Updating config..."

  	    # - Use SED to replace the CLIENT_ID that is currently in google.js
	      sed -i -e "s/YOURCLIENTID.apps.googleusercontent.com/$CLIENT_ID/g" /usr/share/nginx/html/google.js
	  fi

    # If HEALTHCARE_API_ENDPOINT is specified, use the google.js configuration with the modified endpoint
    if [ -n "$HEALTHCARE_API_ENDPOINT" ]
      then
        echo "Google Cloud Healthcare \$HEALTHCARE_API_ENDPOINT has been provided: "
        echo "$HEALTHCARE_API_ENDPOINT"
        echo "Updating config..."

        # - Use SED to replace the HEALTHCARE_API_ENDPOINT that is currently in google.js
        sed -i -e "s+https://healthcare.googleapis.com/v1+$HEALTHCARE_API_ENDPOINT+g" /usr/share/nginx/html/google.js
    fi

	  # - Copy google.js to overwrite app-config.js
	  cp /usr/share/nginx/html/google.js /usr/share/nginx/html/app-config.js
fi

echo "Starting Nginx to serve the OHIF Viewer on ${PUBLIC_URL}"

exec "$@"
