/**
 * Le logotype de Clora, dans la variante du thème.
 *
 * Le logotype est bleu marine : sur un fond sombre, il disparaissait. Les deux
 * variantes sont rendues et la feuille de style montre celle du thème
 * (`data-theme` sur la racine) ; l'image suit ainsi un changement de thème
 * sans que l'écran ait à le connaître.
 */
function Logotype({ alt = 'Clora', style, onError }) {
  return (
    <>
      <img src="/images/logotype.png" alt={alt} className="logotype-clair" style={style} onError={onError} />
      <img src="/images/logotype-sombre.png" alt={alt} className="logotype-sombre" style={style} onError={onError} />
    </>
  );
}

export default Logotype;
