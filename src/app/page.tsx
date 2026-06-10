import SearchForm from "./SearchForm";

export default function HomePage() {
  return (
    <main className="container">
      <div className="hero">
        <h1>Mida on koda teinud sinu ettevõtte heaks?</h1>
        <p>
          Eesti Kaubandus-Tööstuskoda seisab iga päev Eesti ettevõtjate huvide eest – maksudest ja
          tööõigusest kuni ekspordi ja bürokraatia vähendamiseni. Vali oma ettevõtte tegevusala ja
          vajadusel täpsemad filtrid ning näitame koja avaliku töö põhjal, mis on just sinu
          ettevõtte jaoks oluline ja miks liikmelisus end ära tasub.
        </p>
      </div>
      <SearchForm />
    </main>
  );
}
