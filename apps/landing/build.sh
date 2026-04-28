#!/bin/sh
set -e

mkdir -p dist
sed "s|VITE_API_URL_PLACEHOLDER|${VITE_API_URL}|g" index.html > dist/index.html
cp robots.txt dist/robots.txt
cp sitemap.xml dist/sitemap.xml
