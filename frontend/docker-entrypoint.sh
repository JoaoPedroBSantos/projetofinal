#!/bin/sh
# Renderiza o nginx.conf com o endereço do DNS embutido do container.
#
# O site faz proxy de /api e /assets para a API. Como o IP da API muda quando o
# container dela é recriado, o nginx precisa resolver o nome "api" a cada
# requisição (resolver + proxy_pass com variável). O endereço do DNS embutido
# depende do runtime: no Docker é 127.0.0.11, no Podman é o IP do aardvark-dns.
set -e

dns="$(awk '$1 == "nameserver" { print $2; exit }' /etc/resolv.conf)"
[ -n "$dns" ] || dns="127.0.0.11"

sed "s|__RESOLVER__|${dns}|g" /etc/nginx/default.conf.template > /etc/nginx/conf.d/default.conf

# Continua no entrypoint padrão do nginx (templates, IPv6, etc.).
# Nota: o entrypoint padrão da imagem é /docker-entrypoint.sh — este script
# NÃO pode ter o mesmo nome, senão ele sobrescreve o original e se chama
# em loop.
exec /docker-entrypoint.sh "$@"
